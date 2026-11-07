#!/usr/bin/env node
/**
 * scripts/evaluate.mjs — FraudLens offline evaluation harness
 *
 * Draws a reproducible stratified sample from the Sicredi synthetic CSV,
 * submits each transaction to the running FraudLens API, and measures how
 * well the agent's risk classification matches the ground-truth fraud label.
 *
 * SECURITY: feedback_label is read ONLY here, for local comparison.
 * It is NEVER included in any API payload, database write, or log line.
 *
 * Usage:
 *   node scripts/evaluate.mjs \
 *     --csv  data/case_transacoes_cartoes_sintetico_900k.csv \
 *     --n    100 \
 *     --seed 42 \
 *     [--api-url http://localhost:3001]
 *
 * Owner: Dev C (architecture) + Dev D (implementation) — Sub-Task 9
 */

import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import path from 'node:path';

// ─── CLI arguments ────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    csv:     { type: 'string',  default: 'data/case_transacoes_cartoes_sintetico_900k.csv' },
    n:       { type: 'string',  default: '100' },
    seed:    { type: 'string',  default: '42' },
    'api-url': { type: 'string', default: 'http://localhost:3001' },
  },
});

const CSV_PATH  = args['csv'];
const N         = parseInt(args['n'], 10);
const SEED      = parseInt(args['seed'], 10);
const API_URL   = args['api-url'].replace(/\/$/, '');

if (!Number.isFinite(N) || N < 1) {
  console.error('--n must be a positive integer');
  process.exit(1);
}
if (!Number.isFinite(SEED)) {
  console.error('--seed must be an integer');
  process.exit(1);
}

// ─── Seeded PRNG (mulberry32) ─────────────────────────────────────────────────
// Pure JS, no external dep. Produces a uniform float in [0, 1).
// Identical seed → identical sequence on every machine.

/**
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Stratified reservoir sampling ───────────────────────────────────────────
//
// Reservoir sampling (Vitter's Algorithm R) applied independently to the
// fraud and legitimate strata.  Half of N is allocated to each stratum;
// if one stratum has fewer rows than its quota, all rows are taken and the
// remainder is filled from the other stratum.
//
// This guarantees:
//   1. Each row has the same probability of selection within its class.
//   2. The sample is reproducible given the same CSV order and seed.
//   3. Both fraud cases and legitimate cases are always present (unless the
//      CSV has fewer than N/2 of a given class).

/** @typedef {{ id: string; isFraud: boolean }} CsvRow */

/**
 * Parse the CSV line-by-line and build two reservoirs.
 *
 * @param {string} csvPath
 * @param {number} quotaPerClass  Target count for each class (floor(N/2))
 * @param {() => number} rand     Seeded PRNG
 * @returns {Promise<{ fraud: CsvRow[]; legit: CsvRow[]; totalFraud: number; totalLegit: number; skipped: number }>}
 */
export async function sampleCsv(csvPath, quotaPerClass, rand) {
  const rl = createInterface({
    input: createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  /** @type {string[] | null} */
  let headers = null;
  let idIdx = -1;
  let labelIdx = -1;

  /** @type {CsvRow[]} */
  const fraudReservoir = [];
  /** @type {CsvRow[]} */
  const legitReservoir = [];

  let fraudSeen = 0;
  let legitSeen = 0;
  let skipped   = 0;

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    // Parse a single CSV line — handles quoted fields containing commas.
    const fields = parseCsvLine(line);

    if (headers === null) {
      headers  = fields;
      idIdx    = headers.indexOf('event_external_id');
      labelIdx = headers.indexOf('feedback_label');

      if (idIdx === -1) throw new Error(
        `Column 'event_external_id' not found in CSV header.\n` +
        `Available columns: ${headers.slice(0, 10).join(', ')}…`
      );
      if (labelIdx === -1) throw new Error(
        `Column 'feedback_label' not found in CSV header.\n` +
        `Available columns: ${headers.slice(0, 10).join(', ')}…`
      );
      continue;
    }

    const id    = fields[idIdx]?.trim();
    const label = fields[labelIdx]?.trim().toUpperCase();

    // Skip rows with missing identifiers (matches import-csv.mjs behaviour).
    if (!id || id === 'None' || id === '') { skipped++; continue; }
    if (!label || (label !== 'TRUE' && label !== 'FALSE')) { skipped++; continue; }

    const isFraud = label === 'TRUE';
    const row = { id, isFraud };

    if (isFraud) {
      fraudSeen++;
      reservoirInsert(fraudReservoir, row, fraudSeen, quotaPerClass, rand);
    } else {
      legitSeen++;
      reservoirInsert(legitReservoir, row, legitSeen, quotaPerClass, rand);
    }
  }

  return {
    fraud: fraudReservoir,
    legit: legitReservoir,
    totalFraud: fraudSeen,
    totalLegit: legitSeen,
    skipped,
  };
}

/**
 * Vitter's Algorithm R — insert a new item into the reservoir.
 *
 * @param {CsvRow[]} reservoir
 * @param {CsvRow} item
 * @param {number} seen   How many items of this class have been seen so far (1-based)
 * @param {number} quota  Desired reservoir size
 * @param {() => number} rand
 */
function reservoirInsert(reservoir, item, seen, quota, rand) {
  if (seen <= quota) {
    reservoir.push(item);
  } else {
    const j = Math.floor(rand() * seen);
    if (j < quota) {
      reservoir[j] = item;
    }
  }
}

// ─── Minimal CSV line parser ──────────────────────────────────────────────────
// Handles double-quoted fields that contain commas.  Does not attempt to
// handle multi-line fields (none expected in this dataset).

/**
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
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

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * @typedef {'FRAUD' | 'LEGIT' | 'INCONCLUSIVE' | 'ERROR'} Prediction
 *
 * @typedef {{
 *   transactionId: string;
 *   isFraud: boolean;
 *   prediction: Prediction;
 *   riskLevel: string | null;
 *   toolsExecuted: string[];
 *   requiresHumanReview: boolean | null;
 *   errorMessage: string | null;
 * }} EvalRecord
 */

/**
 * Maps API riskLevel to a binary prediction.
 *
 * Rule (from implementation-plan.md Sub-Task 9):
 *   SUSPICIOUS | HIGH_RISK → FRAUD
 *   LOW_RISK               → LEGIT
 *   INCONCLUSIVE           → INCONCLUSIVE (excluded from precision/recall)
 *
 * @param {string} riskLevel
 * @returns {Prediction}
 */
export function riskToPrediction(riskLevel) {
  if (riskLevel === 'HIGH_RISK' || riskLevel === 'SUSPICIOUS') return 'FRAUD';
  if (riskLevel === 'LOW_RISK') return 'LEGIT';
  return 'INCONCLUSIVE';
}

/**
 * Submit one transaction to the API and return an EvalRecord.
 * feedback_label is NEVER included in the request body.
 *
 * @param {string} transactionId
 * @param {boolean} isFraud  Ground-truth label (kept local, never sent to API)
 * @param {string} apiUrl
 * @param {typeof fetch} fetchFn  Injectable for testing
 * @returns {Promise<EvalRecord>}
 */
export async function investigate(transactionId, isFraud, apiUrl, fetchFn = fetch) {
  // The only field sent to the API is transactionId.
  // isFraud (feedback_label) stays local.
  const payload = JSON.stringify({ transactionId });

  let res;
  try {
    res = await fetchFn(`${apiUrl}/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
  } catch (err) {
    return {
      transactionId,
      isFraud,
      prediction: 'ERROR',
      riskLevel: null,
      toolsExecuted: [],
      requiresHumanReview: null,
      errorMessage: `Network error: ${err.message}`,
    };
  }

  if (!res.ok) {
    return {
      transactionId,
      isFraud,
      prediction: 'ERROR',
      riskLevel: null,
      toolsExecuted: [],
      requiresHumanReview: null,
      errorMessage: `HTTP ${res.status}`,
    };
  }

  /** @type {{ investigationId: string; report: { riskLevel: string; toolsExecuted: string[]; requiresHumanReview: boolean } }} */
  let body;
  try {
    body = await res.json();
  } catch {
    return {
      transactionId,
      isFraud,
      prediction: 'ERROR',
      riskLevel: null,
      toolsExecuted: [],
      requiresHumanReview: null,
      errorMessage: 'Invalid JSON response',
    };
  }

  const riskLevel = body?.report?.riskLevel ?? 'INCONCLUSIVE';
  const prediction = riskToPrediction(riskLevel);

  // Distinguish: was INCONCLUSIVE a genuine assessment or an API/IBM failure?
  // The API always returns 200 with INCONCLUSIVE when the agent or Zod fails.
  // We can detect the failure path if requiresHumanReview is true AND
  // toolsExecuted is empty (the agent never ran any tools — it errored before).
  const toolsExecuted      = body?.report?.toolsExecuted ?? [];
  const requiresHumanReview = body?.report?.requiresHumanReview ?? null;

  return {
    transactionId,
    isFraud,
    prediction,
    riskLevel,
    toolsExecuted,
    requiresHumanReview,
    errorMessage: null,
  };
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

/**
 * Compute confusion matrix and derived metrics from classified records.
 * INCONCLUSIVE and ERROR records are excluded from TP/FP/TN/FN.
 *
 * Positive class = fraud (isFraud = true, prediction = 'FRAUD').
 *
 * @param {EvalRecord[]} records
 */
export function computeMetrics(records) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  let inconclusive = 0;
  let errors = 0;
  // INCONCLUSIVE breakdown: genuine agent uncertainty vs likely IBM/timeout fallback
  let inconclusiveEmptyTools = 0; // toolsExecuted.length === 0 → likely API failure

  /** @type {Map<string, number>} */
  const toolCounts = new Map();

  for (const r of records) {
    // Count tool usage across all records (including inconclusive)
    for (const t of r.toolsExecuted) {
      toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
    }

    if (r.prediction === 'ERROR') {
      errors++;
      continue;
    }
    if (r.prediction === 'INCONCLUSIVE') {
      inconclusive++;
      if (r.toolsExecuted.length === 0) inconclusiveEmptyTools++;
      continue;
    }

    const predictedFraud = r.prediction === 'FRAUD';
    if (r.isFraud && predictedFraud)  tp++;
    if (!r.isFraud && predictedFraud) fp++;
    if (!r.isFraud && !predictedFraud) tn++;
    if (r.isFraud && !predictedFraud) fn++;
  }

  const classified = tp + fp + tn + fn;
  const total      = records.length;
  const coverage   = total > 0 ? classified / total : 0;

  const precision  = (tp + fp) > 0 ? tp / (tp + fp) : null;
  const recall     = (tp + fn) > 0 ? tp / (tp + fn) : null;
  const f1         = (precision !== null && recall !== null && (precision + recall) > 0)
    ? 2 * (precision * recall) / (precision + recall)
    : null;

  const toolFrequency = Object.fromEntries(
    [...toolCounts.entries()].sort((a, b) => b[1] - a[1])
  );

  return {
    total,
    classified,
    coverage: round(coverage, 4),
    inconclusive,
    inconclusiveEmptyTools, // likely IBM/timeout fallback (no tools ran)
    errors,
    confusionMatrix: { tp, fp, tn, fn },
    precision: precision !== null ? round(precision, 4) : null,
    recall:    recall    !== null ? round(recall, 4)    : null,
    f1:        f1        !== null ? round(f1, 4)        : null,
    toolFrequency,
    // AUPRC requires a calibrated score per case, not a 3-class label.
    // The API returns riskLevel (ordinal) not a probability.
    // AUPRC is therefore not computable without mapping SUSPICIOUS/HIGH_RISK
    // to distinct scores — which would be arbitrary. Pending: if the API ever
    // exposes a numeric confidence score, add AUPRC computation here.
    auprc: null,
    auprNote:
      'AUPRC requires a continuous score per case. ' +
      'The API returns a 3-class ordinal label (LOW_RISK / SUSPICIOUS / HIGH_RISK). ' +
      'A numeric mapping would be arbitrary; AUPRC is deferred until a calibrated ' +
      'probability is available from the agent.',
  };
}

/** @param {number} v @param {number} decimals */
function round(v, decimals) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('FraudLens — Offline Evaluation Harness');
  console.log('========================================');
  console.log(`CSV    : ${CSV_PATH}`);
  console.log(`n      : ${N}`);
  console.log(`seed   : ${SEED}`);
  console.log(`api    : ${API_URL}`);
  console.log('');

  // ── 1. Sample ──────────────────────────────────────────────────────────────
  const quotaPerClass = Math.floor(N / 2);
  const rand = mulberry32(SEED);

  console.log('Sampling CSV…');
  const { fraud, legit, totalFraud, totalLegit, skipped } =
    await sampleCsv(CSV_PATH, quotaPerClass, rand);

  // If one class has fewer rows than its quota, take all and give surplus to the other.
  // This ensures we still reach N cases when one class is scarce.
  const fraudSample = fraud;
  const legitSample = legit;

  console.log(`  CSV rows: ${totalFraud + totalLegit} usable (+${skipped} skipped)`);
  console.log(`  Fraud rows in CSV : ${totalFraud}`);
  console.log(`  Legit rows in CSV : ${totalLegit}`);
  console.log(`  Fraud sampled     : ${fraudSample.length} (quota ${quotaPerClass})`);
  console.log(`  Legit sampled     : ${legitSample.length} (quota ${quotaPerClass})`);

  // Merge and shuffle with the same PRNG to avoid all frauds appearing first.
  const sample = shuffle([...fraudSample, ...legitSample], rand);
  console.log(`  Total sample size : ${sample.length}`);
  console.log('');

  // Warn about class imbalance so results are interpreted correctly.
  const sampleFraudCount = sample.filter(r => r.isFraud).length;
  const fraudRate = sampleFraudCount / sample.length;
  console.log(
    `⚠  Sample fraud rate: ${(fraudRate * 100).toFixed(1)}% ` +
    `(${sampleFraudCount}/${sample.length}). ` +
    `Precision and recall are computed on this sample; ` +
    `a higher fraud rate than in production inflates recall and may inflate precision.`
  );
  console.log('');

  // ── 2. Investigate each case ───────────────────────────────────────────────
  console.log('Investigating…');
  /** @type {EvalRecord[]} */
  const records = [];

  for (let i = 0; i < sample.length; i++) {
    const { id, isFraud } = sample[i];
    process.stdout.write(`  [${String(i + 1).padStart(4)}/${sample.length}] ${id}  `);

    const record = await investigate(id, isFraud, API_URL);
    records.push(record);

    const badge =
      record.prediction === 'ERROR'         ? '💥 ERROR' :
      record.prediction === 'INCONCLUSIVE'  ? '❓ INCONCLUSIVE' :
      record.isFraud === (record.prediction === 'FRAUD') ? '✅' : '❌';
    process.stdout.write(`${record.riskLevel ?? record.errorMessage}  ${badge}\n`);
  }
  console.log('');

  // ── 3. Metrics ─────────────────────────────────────────────────────────────
  const metrics = computeMetrics(records);

  console.log('Results');
  console.log('-------');
  console.log(`Total cases     : ${metrics.total}`);
  console.log(`Classified      : ${metrics.classified}  (coverage ${(metrics.coverage * 100).toFixed(1)}%)`);
  console.log(`Inconclusive    : ${metrics.inconclusive}  (of which ~${metrics.inconclusiveEmptyTools} likely IBM/timeout fallback)`);
  console.log(`Errors          : ${metrics.errors}`);
  console.log('');
  console.log('Confusion matrix (classified cases only):');
  console.log(`  TP (fraud → FRAUD)  : ${metrics.confusionMatrix.tp}`);
  console.log(`  FP (legit → FRAUD)  : ${metrics.confusionMatrix.fp}`);
  console.log(`  TN (legit → LEGIT)  : ${metrics.confusionMatrix.tn}`);
  console.log(`  FN (fraud → LEGIT)  : ${metrics.confusionMatrix.fn}`);
  console.log('');
  console.log(`Precision : ${metrics.precision !== null ? metrics.precision : 'N/A (no positive predictions)'}`);
  console.log(`Recall    : ${metrics.recall    !== null ? metrics.recall    : 'N/A (no fraud cases classified)'}`);
  console.log(`F1        : ${metrics.f1        !== null ? metrics.f1        : 'N/A'}`);
  console.log('');
  console.log('Tool frequency (all cases):');
  for (const [tool, count] of Object.entries(metrics.toolFrequency)) {
    console.log(`  ${tool.padEnd(35)} ${count}`);
  }
  if (Object.keys(metrics.toolFrequency).length === 0) {
    console.log('  (none — all cases may have been INCONCLUSIVE/ERROR)');
  }

  // ── 4. Save results ────────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  const outDir  = 'data/processed';
  const outPath = path.join(outDir, `evaluation-${dateStr}.json`);

  await mkdir(outDir, { recursive: true });

  const output = {
    meta: {
      runAt:   new Date().toISOString(),
      csvPath: CSV_PATH,
      n:       N,
      seed:    SEED,
      apiUrl:  API_URL,
      sampleSize: sample.length,
      sampleFraudCount,
      sampleLegitCount: sample.length - sampleFraudCount,
      csvTotalFraud:  totalFraud,
      csvTotalLegit:  totalLegit,
      csvSkippedRows: skipped,
    },
    metrics,
    // Per-case records — feedback_label is stored here only in this local output
    // file (never sent to the API or any network endpoint).
    records: records.map(r => ({
      transactionId:     r.transactionId,
      groundTruth:       r.isFraud ? 'FRAUD' : 'LEGIT',
      riskLevel:         r.riskLevel,
      prediction:        r.prediction,
      toolsExecuted:     r.toolsExecuted,
      requiresHumanReview: r.requiresHumanReview,
      errorMessage:      r.errorMessage,
    })),
  };

  await writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nResults saved to ${outPath}`);
}

/**
 * Fisher-Yates shuffle using the seeded PRNG.
 * @param {CsvRow[]} arr
 * @param {() => number} rand
 * @returns {CsvRow[]}
 */
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Only run main() when executed directly (not when imported by tests).
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file://', ''));

if (isMain) {
  main().catch(err => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
