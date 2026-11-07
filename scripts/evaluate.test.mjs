/**
 * scripts/evaluate.test.mjs — unit tests for the evaluation harness.
 *
 * Runs with Node's built-in test runner (node:test + node:assert).
 * No real CSV, no real HTTP — all inputs are in-memory fixtures.
 *
 * Test plan:
 *   1. parseCsvLine — basic CSV parsing including quoted fields
 *   2. sampleCsv    — same seed → same sample; proportions correct; skips bad rows
 *   3. investigate  — payload never contains feedback_label; response shapes
 *   4. riskToPrediction — all four riskLevel values map correctly
 *   5. computeMetrics  — confusion matrix totals; INCONCLUSIVE excluded; coverage
 *   6. Integration  — run investigate over a sample, totals consistent
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseCsvLine, riskToPrediction, computeMetrics, investigate } from './evaluate.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds an in-memory CSV string from a list of records.
 * Always includes event_external_id and feedback_label columns.
 *
 * @param {{ id: string; label: 'TRUE' | 'FALSE' }[]} rows
 * @returns {string}
 */
function buildCsv(rows) {
  const header = 'event_external_id,customer_id,amount,feedback_label';
  const lines  = rows.map(r => `${r.id},CUST_001,100.00,${r.label}`);
  return [header, ...lines].join('\n');
}

/**
 * Patch sampleCsv to accept a string instead of a file path.
 * We override createReadStream by passing a factory that wraps a Readable.
 *
 * The real sampleCsv uses createReadStream internally, so we call it with a
 * real file path but intercept the stream at import time — instead, we
 * replicate its logic directly here using the exported parseCsvLine.
 */

/**
 * Inline re-implementation of sampleCsv that reads from a string instead of a
 * file. Allows tests to run without touching the filesystem.
 *
 * @param {string} csvString
 * @param {number} quotaPerClass
 * @param {() => number} rand
 */
async function sampleCsvString(csvString, quotaPerClass, rand) {
  const lines  = csvString.split('\n').map(l => l.trim()).filter(Boolean);
  let headers  = null;
  let idIdx    = -1;
  let labelIdx = -1;

  const fraudReservoir = [];
  const legitReservoir = [];
  let fraudSeen = 0;
  let legitSeen = 0;
  let skipped   = 0;

  for (const line of lines) {
    const fields = parseCsvLine(line);

    if (headers === null) {
      headers  = fields;
      idIdx    = headers.indexOf('event_external_id');
      labelIdx = headers.indexOf('feedback_label');
      continue;
    }

    const id    = fields[idIdx]?.trim();
    const label = fields[labelIdx]?.trim().toUpperCase();

    if (!id || id === 'None' || id === '') { skipped++; continue; }
    if (!label || (label !== 'TRUE' && label !== 'FALSE')) { skipped++; continue; }

    const isFraud = label === 'TRUE';
    const row     = { id, isFraud };

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

function reservoirInsert(reservoir, item, seen, quota, rand) {
  if (seen <= quota) {
    reservoir.push(item);
  } else {
    const j = Math.floor(rand() * seen);
    if (j < quota) reservoir[j] = item;
  }
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 1. parseCsvLine ──────────────────────────────────────────────────────────

describe('parseCsvLine', () => {
  it('splits a simple CSV line', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });

  it('handles quoted fields containing commas', () => {
    assert.deepEqual(parseCsvLine('"a,b",c'), ['a,b', 'c']);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    assert.deepEqual(parseCsvLine('"a""b",c'), ['a"b', 'c']);
  });

  it('handles empty fields', () => {
    assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c']);
  });

  it('handles a single field', () => {
    assert.deepEqual(parseCsvLine('hello'), ['hello']);
  });
});

// ─── 2. sampleCsv (via sampleCsvString) ──────────────────────────────────────

describe('sampleCsvString', () => {
  it('same seed produces the same sample', async () => {
    // 10 fraud + 40 legit rows, quota = 5 each
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `FRAUD_${i}`, label: 'TRUE'  })),
      ...Array.from({ length: 40 }, (_, i) => ({ id: `LEGIT_${i}`, label: 'FALSE' })),
    ];
    const csv = buildCsv(rows);

    const run1 = await sampleCsvString(csv, 5, mulberry32(42));
    const run2 = await sampleCsvString(csv, 5, mulberry32(42));

    assert.deepEqual(
      run1.fraud.map(r => r.id).sort(),
      run2.fraud.map(r => r.id).sort(),
    );
    assert.deepEqual(
      run1.legit.map(r => r.id).sort(),
      run2.legit.map(r => r.id).sort(),
    );
  });

  it('different seeds produce different samples (probabilistically)', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `LEGIT_${i}`, label: 'FALSE' }));
    const csv  = buildCsv(rows);

    const run1 = await sampleCsvString(csv, 10, mulberry32(1));
    const run2 = await sampleCsvString(csv, 10, mulberry32(999));

    // It is astronomically unlikely for two 10-of-50 samples with different
    // seeds to be identical; assert they differ.
    const ids1 = new Set(run1.legit.map(r => r.id));
    const ids2 = new Set(run2.legit.map(r => r.id));
    const intersection = [...ids1].filter(id => ids2.has(id));
    assert.ok(
      intersection.length < 10,
      'Expected samples with different seeds to differ'
    );
  });

  it('correctly counts fraud and legit rows', async () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => ({ id: `F_${i}`, label: 'TRUE'  })),
      ...Array.from({ length: 7 }, (_, i) => ({ id: `L_${i}`, label: 'FALSE' })),
    ];
    const csv = buildCsv(rows);
    const { totalFraud, totalLegit } = await sampleCsvString(csv, 5, mulberry32(1));
    assert.equal(totalFraud, 3);
    assert.equal(totalLegit, 7);
  });

  it('skips rows with missing or "None" id', async () => {
    const csv = [
      'event_external_id,customer_id,amount,feedback_label',
      ',CUST,100,FALSE',      // empty id
      'None,CUST,100,TRUE',   // "None" id
      'EVT_001,CUST,100,FALSE', // valid
    ].join('\n');

    const { totalFraud, totalLegit, skipped } = await sampleCsvString(csv, 5, mulberry32(1));
    assert.equal(totalFraud, 0);
    assert.equal(totalLegit, 1);
    assert.equal(skipped, 2);
  });

  it('skips rows with unrecognised label values', async () => {
    const csv = [
      'event_external_id,customer_id,amount,feedback_label',
      'EVT_001,CUST,100,MAYBE',  // invalid label
      'EVT_002,CUST,100,FALSE',  // valid
    ].join('\n');

    const { totalLegit, skipped } = await sampleCsvString(csv, 5, mulberry32(1));
    assert.equal(totalLegit, 1);
    assert.equal(skipped, 1);
  });

  it('takes all rows when quota exceeds class size', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `F_${i}`, label: 'TRUE' }));
    const csv  = buildCsv(rows);
    const { fraud } = await sampleCsvString(csv, 10, mulberry32(1));
    assert.equal(fraud.length, 3);  // only 3 available
  });

  it('reservoir size never exceeds quota', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `L_${i}`, label: 'FALSE' }));
    const csv  = buildCsv(rows);
    const { legit } = await sampleCsvString(csv, 15, mulberry32(7));
    assert.equal(legit.length, 15);
  });
});

// ─── 3. investigate ───────────────────────────────────────────────────────────

describe('investigate', () => {
  /**
   * Builds a mock fetch that returns a fixed InvestigationResult.
   * Also records every request body so tests can assert on the payload.
   */
  function mockFetch(riskLevel = 'LOW_RISK', status = 200) {
    /** @type {string[]} */
    const bodies = [];

    const fn = async (_url, opts) => {
      bodies.push(opts.body);
      if (status !== 200) {
        return { ok: false, status, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          investigationId: 'inv-123',
          report: {
            riskLevel,
            toolsExecuted: ['getTransactionDetails', 'getCustomerProfile'],
            requiresHumanReview: false,
            recommendedAction: 'PROCEED',
            explanation: 'All good.',
          },
        }),
      };
    };

    fn.bodies = bodies;
    return fn;
  }

  it('sends only transactionId in the request body — never feedback_label', async () => {
    const mock = mockFetch('LOW_RISK');
    await investigate('EVT_001', true, 'http://api', mock);

    assert.equal(mock.bodies.length, 1);
    const parsed = JSON.parse(mock.bodies[0]);

    assert.ok('transactionId' in parsed, 'payload must contain transactionId');
    assert.ok(!('isFraud' in parsed),     'payload must NOT contain isFraud');
    assert.ok(!('feedback_label' in parsed), 'payload must NOT contain feedback_label');
    assert.ok(!('label' in parsed),       'payload must NOT contain label');
    assert.equal(Object.keys(parsed).length, 1, 'payload must contain exactly one field');
  });

  it('maps LOW_RISK to LEGIT prediction', async () => {
    const r = await investigate('EVT_001', false, 'http://api', mockFetch('LOW_RISK'));
    assert.equal(r.prediction, 'LEGIT');
    assert.equal(r.riskLevel,  'LOW_RISK');
  });

  it('maps SUSPICIOUS to FRAUD prediction', async () => {
    const r = await investigate('EVT_002', true, 'http://api', mockFetch('SUSPICIOUS'));
    assert.equal(r.prediction, 'FRAUD');
  });

  it('maps HIGH_RISK to FRAUD prediction', async () => {
    const r = await investigate('EVT_003', true, 'http://api', mockFetch('HIGH_RISK'));
    assert.equal(r.prediction, 'FRAUD');
  });

  it('maps INCONCLUSIVE to INCONCLUSIVE prediction — not counted as LEGIT', async () => {
    const r = await investigate('EVT_004', true, 'http://api', mockFetch('INCONCLUSIVE'));
    assert.equal(r.prediction, 'INCONCLUSIVE');
    // Must NOT be counted as LEGIT even though isFraud=true.
    assert.notEqual(r.prediction, 'LEGIT');
  });

  it('preserves isFraud locally but does not send it', async () => {
    const mock = mockFetch('HIGH_RISK');
    const r = await investigate('EVT_005', true, 'http://api', mock);
    assert.equal(r.isFraud, true);
    // Confirm it was not in the payload
    const parsed = JSON.parse(mock.bodies[0]);
    assert.ok(!('isFraud' in parsed));
  });

  it('returns ERROR prediction on network failure', async () => {
    const broken = async () => { throw new Error('ECONNREFUSED'); };
    const r = await investigate('EVT_006', false, 'http://api', broken);
    assert.equal(r.prediction, 'ERROR');
    assert.ok(r.errorMessage.includes('ECONNREFUSED'));
  });

  it('returns ERROR prediction on non-200 HTTP status', async () => {
    const r = await investigate('EVT_007', false, 'http://api', mockFetch('LOW_RISK', 400));
    assert.equal(r.prediction, 'ERROR');
    assert.ok(r.errorMessage.includes('400'));
  });

  it('records toolsExecuted from the API response', async () => {
    const r = await investigate('EVT_008', false, 'http://api', mockFetch('LOW_RISK'));
    assert.deepEqual(r.toolsExecuted, ['getTransactionDetails', 'getCustomerProfile']);
  });
});

// ─── 4. riskToPrediction ──────────────────────────────────────────────────────

describe('riskToPrediction', () => {
  it('maps HIGH_RISK to FRAUD', ()        => assert.equal(riskToPrediction('HIGH_RISK'),    'FRAUD'));
  it('maps SUSPICIOUS to FRAUD', ()       => assert.equal(riskToPrediction('SUSPICIOUS'),   'FRAUD'));
  it('maps LOW_RISK to LEGIT', ()         => assert.equal(riskToPrediction('LOW_RISK'),     'LEGIT'));
  it('maps INCONCLUSIVE to INCONCLUSIVE', () => assert.equal(riskToPrediction('INCONCLUSIVE'), 'INCONCLUSIVE'));
  it('maps unknown value to INCONCLUSIVE', () => assert.equal(riskToPrediction('UNKNOWN'),   'INCONCLUSIVE'));
});

// ─── 5. computeMetrics ───────────────────────────────────────────────────────

describe('computeMetrics', () => {
  /** Shorthand builder. */
  function rec(isFraud, prediction, riskLevel = null, toolsExecuted = []) {
    return {
      transactionId:       'EVT_X',
      isFraud,
      prediction,
      riskLevel:           riskLevel ?? (prediction === 'FRAUD' ? 'HIGH_RISK' : 'LOW_RISK'),
      toolsExecuted,
      requiresHumanReview: false,
      errorMessage:        null,
    };
  }

  it('computes correct TP, FP, TN, FN', () => {
    const records = [
      rec(true,  'FRAUD'),   // TP
      rec(false, 'FRAUD'),   // FP
      rec(false, 'LEGIT'),   // TN
      rec(true,  'LEGIT'),   // FN
    ];
    const m = computeMetrics(records);
    assert.deepEqual(m.confusionMatrix, { tp: 1, fp: 1, tn: 1, fn: 1 });
    assert.equal(m.classified, 4);
  });

  it('excludes INCONCLUSIVE from confusion matrix but counts it separately', () => {
    const records = [
      rec(true,  'FRAUD'),
      rec(true,  'INCONCLUSIVE'),
      rec(false, 'LEGIT'),
    ];
    const m = computeMetrics(records);
    assert.equal(m.inconclusive, 1);
    assert.equal(m.classified, 2);
    assert.deepEqual(m.confusionMatrix, { tp: 1, fp: 0, tn: 1, fn: 0 });
  });

  it('excludes ERROR records from confusion matrix', () => {
    const errRec = { ...rec(false, 'ERROR'), prediction: 'ERROR', riskLevel: null, errorMessage: 'HTTP 500' };
    const records = [
      rec(true, 'FRAUD'),
      errRec,
    ];
    const m = computeMetrics(records);
    assert.equal(m.errors, 1);
    assert.equal(m.classified, 1);
  });

  it('computes precision, recall, F1 correctly for a perfect classifier', () => {
    const records = [
      rec(true,  'FRAUD'),
      rec(false, 'LEGIT'),
      rec(true,  'FRAUD'),
      rec(false, 'LEGIT'),
    ];
    const m = computeMetrics(records);
    assert.equal(m.precision, 1);
    assert.equal(m.recall,    1);
    assert.equal(m.f1,        1);
  });

  it('returns null for precision/recall when no positives', () => {
    const records = [rec(false, 'LEGIT'), rec(false, 'LEGIT')];
    const m = computeMetrics(records);
    assert.equal(m.precision, null);
    // recall is null because there are no fraud cases
    assert.equal(m.recall, null);
  });

  it('coverage equals classified / total', () => {
    const records = [
      rec(true,  'FRAUD'),
      rec(true,  'INCONCLUSIVE'),
      rec(false, 'LEGIT'),
      { ...rec(false, 'ERROR'), prediction: 'ERROR', riskLevel: null, errorMessage: 'err' },
    ];
    const m = computeMetrics(records);
    // classified = TP(1) + TN(1) = 2; total = 4
    assert.equal(m.classified, 2);
    assert.equal(m.total,      4);
    assert.equal(m.coverage,   0.5);
  });

  it('identifies INCONCLUSIVE cases with empty toolsExecuted as likely IBM failures', () => {
    const records = [
      rec(true, 'INCONCLUSIVE', 'INCONCLUSIVE', ['getTransactionDetails']), // genuine
      rec(true, 'INCONCLUSIVE', 'INCONCLUSIVE', []),                         // likely failure
    ];
    const m = computeMetrics(records);
    assert.equal(m.inconclusive, 2);
    assert.equal(m.inconclusiveEmptyTools, 1);
  });

  it('counts tool frequency across all records', () => {
    const records = [
      rec(true,  'FRAUD', 'HIGH_RISK', ['getTransactionDetails', 'getCustomerProfile']),
      rec(false, 'LEGIT', 'LOW_RISK',  ['getTransactionDetails']),
    ];
    const m = computeMetrics(records);
    assert.equal(m.toolFrequency['getTransactionDetails'], 2);
    assert.equal(m.toolFrequency['getCustomerProfile'],    1);
  });

  it('auprc is null with a note explaining why', () => {
    const m = computeMetrics([rec(true, 'FRAUD'), rec(false, 'LEGIT')]);
    assert.equal(m.auprc, null);
    assert.ok(typeof m.auprNote === 'string' && m.auprNote.length > 0);
  });

  it('returns zero coverage when no records', () => {
    const m = computeMetrics([]);
    assert.equal(m.coverage, 0);
    assert.equal(m.total,    0);
  });
});

// ─── 6. Integration: end-to-end over a small sample ─────────────────────────

describe('integration: investigate + computeMetrics', () => {
  it('totals are internally consistent: classified + inconclusive + errors = total', async () => {
    // Build a mock fetch: first 3 calls succeed; 4th is INCONCLUSIVE; 5th fails
    const responses = [
      { ok: true, riskLevel: 'HIGH_RISK',    tools: ['getTransactionDetails'] },
      { ok: true, riskLevel: 'LOW_RISK',     tools: ['getTransactionDetails'] },
      { ok: true, riskLevel: 'SUSPICIOUS',   tools: ['getTransactionDetails'] },
      { ok: true, riskLevel: 'INCONCLUSIVE', tools: [] },
      { ok: false, status: 503 },
    ];

    let call = 0;
    const mockFetch = async (_url, _opts) => {
      const r = responses[call++];
      if (!r.ok) return { ok: false, status: r.status, json: async () => ({}) };
      return {
        ok: true, status: 200,
        json: async () => ({
          investigationId: `inv-${call}`,
          report: {
            riskLevel: r.riskLevel,
            toolsExecuted: r.tools,
            requiresHumanReview: false,
          },
        }),
      };
    };

    const cases = [
      { id: 'E1', isFraud: true  },
      { id: 'E2', isFraud: false },
      { id: 'E3', isFraud: false },
      { id: 'E4', isFraud: true  },
      { id: 'E5', isFraud: false },
    ];

    const records = await Promise.all(
      cases.map(c => investigate(c.id, c.isFraud, 'http://api', mockFetch))
    );

    const m = computeMetrics(records);

    assert.equal(
      m.classified + m.inconclusive + m.errors,
      m.total,
      'classified + inconclusive + errors must equal total'
    );
    assert.equal(m.total, 5);
    assert.equal(m.inconclusive, 1);
    assert.equal(m.errors, 1);
    assert.equal(m.classified, 3);
  });
});
