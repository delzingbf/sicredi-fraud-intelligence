#!/usr/bin/env node
/**
 * import-csv.mjs — imports the Sicredi synthetic transaction CSV into PostgreSQL.
 *
 * Usage:
 *   node scripts/import-csv.mjs
 *   node scripts/import-csv.mjs --csv data/custom.csv
 *   node scripts/import-csv.mjs --db-url postgresql://user:pass@host:5432/db
 *
 * Prerequisites:
 *   1. Migration applied:  pnpm --filter @fraud-intelligence/api migration:run
 *   2. Dependencies:       pnpm install   (needs pg and pg-copy-streams)
 *
 * Strategy:
 *   - Stream CSV line-by-line via readline (no full file in memory).
 *   - Transform each row into a tab-separated line (PostgreSQL TEXT COPY format).
 *   - Load into a temp staging table via COPY FROM STDIN.
 *   - INSERT ... ON CONFLICT (id) DO NOTHING from staging → transactions.
 *     This makes the script safe to re-run (idempotent).
 *
 * Security: feedback_label and all post-authorisation fields are excluded.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const csvPath = argValue(args, '--csv') ?? 'data/case_transacoes_cartoes_sintetico_900k.csv';
const dbUrl =
  argValue(args, '--db-url') ??
  process.env['DATABASE_URL'] ??
  'postgresql://fraudlens:fraudlens@localhost:5432/fraudlens';

function argValue(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : null;
}

// ── Columns to import (security: feedback_label and post-auth fields excluded) ─

// Maps DB column name → CSV column name when they differ.
const CSV_COLUMN_ALIAS = {
  id: 'event_external_id',
};

// NOT NULL columns in the DB — rows where any of these are empty/None are skipped.
const NOT_NULL_COLUMNS = new Set(['id', 'customer_id', 'event_occurred_at']);

// Columns whose CSV values are Y/N and must be converted to true/false.
const YN_BOOLEAN_COLUMNS = new Set([
  'card_presence_flag',
]);

// Columns whose CSV values are True/False strings.
const BOOL_STRING_COLUMNS = new Set([
  'malware_flag',
  'customer_email_change_flag',
  'customer_phone_change_flag',
]);

const IMPORT_COLUMNS = [
  'id',
  'customer_id',
  'card_id',
  'acceptor_id',
  'account_id',
  'terminal_id',
  'amount',
  'event_occurred_at',
  'tipo_transacao',
  'modalidade_transacao',
  'segment_channel_type',
  'card_presence_flag',
  'mcc',
  'acceptor_name',
  'acceptor_city',
  'acceptor_region',
  'acceptor_latitude',
  'acceptor_longitude',
  'acceptor_risk',
  'acceptor_risky_flag',
  'acceptor_mastercard_risk',
  'acceptor_visa_risk',
  'terminal_latitude',
  'terminal_longitude',
  'device_ip_latitude',
  'device_ip_longitude',
  'cardid_count_1m',
  'cp_card_prev_term_dist_1h',
  'cp_card_term_vel_1h',
  'transaction_status',
  'malware_flag',
  'customer_risk_rating',
  'customer_name',
  'customer_segment',
  'customer_city',
  'customer_region',
  'customer_registration_date',
  'customer_total_credit_limit',
  'customer_total_balance',
  'customer_presumed_income',
  'customer_onboarding_score',
  'customer_kyc_lvl',
  'customer_number_of_cards',
  'customer_email_change_flag',
  'customer_phone_change_flag',
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('FraudLens CSV Importer');
  console.log(`  CSV:      ${csvPath}`);
  console.log(`  Database: ${dbUrl.replace(/:\/\/[^@]+@/, '://<credentials>@')}`);
  console.log('');

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  // Verify the table exists (migration must have run).
  const { rows } = await client.query(
    `SELECT to_regclass('public.transactions') AS tbl`,
  );
  if (!rows[0]?.tbl) {
    console.error(
      'ERROR: Table `transactions` does not exist.\n' +
        'Run the migration first: pnpm --filter @fraud-intelligence/api migration:run',
    );
    await client.end();
    process.exit(1);
  }

  // ── Step 1: parse CSV header to build column-index map ──────────────────────
  const headerLine = await readFirstLine(csvPath);
  if (!headerLine) {
    console.error('ERROR: CSV file is empty or unreadable.');
    await client.end();
    process.exit(1);
  }

  const csvColumns = parseCsvLine(headerLine);
  /** @type {Map<string, number>} */
  const colIndex = new Map();
  for (const col of IMPORT_COLUMNS) {
    const csvName = CSV_COLUMN_ALIAS[col] ?? col;
    const idx = csvColumns.indexOf(csvName);
    if (idx === -1) {
      console.warn(`  WARNING: column "${csvName}" not found in CSV — will be NULL`);
    }
    colIndex.set(col, idx);
  }
  console.log(`  Columns mapped: ${IMPORT_COLUMNS.length} of ${csvColumns.length} CSV columns`);

  // ── Step 2: create temp staging table ──────────────────────────────────────
  await client.query(`
    CREATE TEMP TABLE transactions_staging (LIKE transactions INCLUDING ALL)
  `);

  // ── Step 3: stream CSV → staging table via COPY ─────────────────────────────
  console.log('  Streaming rows into staging table...');
  const startMs = Date.now();
  let rowsProcessed = 0;

  const copyTarget = client.query(
    copyFrom(
      `COPY transactions_staging (${IMPORT_COLUMNS.join(', ')}) FROM STDIN WITH (FORMAT TEXT, NULL '\\N')`,
    ),
  );

  // Build an async generator that yields tab-separated lines, skipping the header.
  let rowsSkipped = 0;
  async function* csvToTabLines() {
    const fileStream = createReadStream(csvPath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
    let firstLine = true;

    for await (const line of rl) {
      if (firstLine) {
        firstLine = false;
        continue; // skip header
      }
      if (!line.trim()) continue;

      const fields = parseCsvLine(line);

      // Skip rows missing any NOT NULL column (event_occurred_at, customer_id, id).
      let skip = false;
      for (const col of NOT_NULL_COLUMNS) {
        const idx = colIndex.get(col);
        const raw = (idx !== undefined && idx !== -1) ? (fields[idx] ?? '') : '';
        if (raw === '' || raw === 'None' || raw === 'NULL' || raw === 'null') {
          skip = true;
          break;
        }
      }
      if (skip) {
        rowsSkipped++;
        continue;
      }

      const tabRow = IMPORT_COLUMNS.map((col) => {
        const idx = colIndex.get(col);
        if (idx === undefined || idx === -1) return '\\N';
        const raw = fields[idx] ?? '';
        if (YN_BOOLEAN_COLUMNS.has(col)) return normalizeYNBoolean(raw);
        if (BOOL_STRING_COLUMNS.has(col)) return normalizeBoolString(raw);
        return normalizeCopyValue(raw);
      }).join('\t');

      yield tabRow + '\n';
      rowsProcessed++;

      if (rowsProcessed % 50_000 === 0) {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
        process.stdout.write(`\r  Rows streamed: ${rowsProcessed.toLocaleString()} (${elapsed}s)  `);
      }
    }
  }

  const readable = Readable.from(csvToTabLines(), { objectMode: false });
  await pipeline(readable, copyTarget);

  process.stdout.write('\n');
  console.log(`  Staging load complete: ${rowsProcessed.toLocaleString()} rows`);

  // ── Step 4: upsert from staging → final table ─────────────────────────────
  console.log('  Inserting into transactions (ON CONFLICT DO NOTHING)...');
  const { rowCount } = await client.query(`
    INSERT INTO transactions
    SELECT * FROM transactions_staging
    ON CONFLICT (id) DO NOTHING
  `);

  await client.query(`DROP TABLE transactions_staging`);
  await client.end();

  const totalMs = Date.now() - startMs;
  console.log('\n  ✓ Import complete');
  console.log(`    Rows processed:  ${rowsProcessed.toLocaleString()}`);
  console.log(`    Rows skipped:    ${rowsSkipped.toLocaleString()} (missing NOT NULL fields)`);
  console.log(`    Rows inserted:   ${(rowCount ?? 0).toLocaleString()} (duplicates skipped)`);
  console.log(`    Elapsed:         ${(totalMs / 1000).toFixed(1)}s`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read only the first line of a file (the CSV header). */
async function readFirstLine(filePath) {
  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    rl.close();
    fileStream.destroy();
    return line;
  }
  return null;
}

/**
 * Parse a single CSV line respecting double-quoted fields.
 * Handles escaped double-quotes ("") inside quoted fields.
 * Does not handle multi-line quoted values (not present in this dataset).
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip second quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Normalize a CSV field for PostgreSQL TEXT COPY format.
 * Empty, 'None', 'NULL', 'null' → NULL marker `\N`.
 * Special characters (backslash, tab, newline) are escaped.
 */
function normalizeCopyValue(value) {
  if (value === '' || value === 'None' || value === 'NULL' || value === 'null') {
    return '\\N';
  }
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Normalize Y/N CSV values to PostgreSQL boolean TEXT format.
 * Y → true, N → false, empty/None → NULL.
 */
function normalizeYNBoolean(value) {
  if (value === '' || value === 'None' || value === 'NULL' || value === 'null') return '\\N';
  if (value === 'Y' || value === 'y' || value === '1' || value === 'true' || value === 'True') return 'true';
  if (value === 'N' || value === 'n' || value === '0' || value === 'false' || value === 'False') return 'false';
  return '\\N'; // unexpected value → NULL (safe fallback)
}

/**
 * Normalize True/False string CSV values to PostgreSQL boolean TEXT format.
 * True/1/Y → true, False/0/N → false, empty/None → NULL.
 */
function normalizeBoolString(value) {
  if (value === '' || value === 'None' || value === 'NULL' || value === 'null') return '\\N';
  if (value === 'True' || value === 'true' || value === '1' || value === 'Y') return 'true';
  if (value === 'False' || value === 'false' || value === '0' || value === 'N') return 'false';
  return '\\N'; // unexpected value → NULL (safe fallback)
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
