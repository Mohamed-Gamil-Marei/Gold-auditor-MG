import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupPagesIntoDays,
  rankSuspectRowsForDiff,
  ScannedLedgerPage,
} from '../src/import/ledgerGrouping';

const makeMockPage = (
  pageNumber: number,
  kind: ScannedLedgerPage['kind'],
  detectedDate: string | null,
  rowsCount: number,
  handwrittenSellTotal: number | null = null,
  handwrittenSellWeightG: number | null = null
): ScannedLedgerPage => ({
  id: `p-${pageNumber}`,
  pageNumber,
  rawImageDataUrl: 'data:image/jpeg;base64,abc',
  imageHash: `hash-${pageNumber}`,
  rotationDeg: 0,
  regions: [],
  kind,
  detectedDate,
  weekday: null,
  dayGoldPrice: 3800,
  openingBalance: null,
  closingBalance: null,
  side: 'both',
  pageNumberHint: String(pageNumber),
  avgConfidence: 0.9,
  rows: Array.from({ length: rowsCount }, (_, i) => ({
    id: `r-${pageNumber}-${i}`,
    approved: true,
    type: 'sell' as const,
    item: `خاتم ${i + 1}`,
    weightG: 5,
    total: 19000,
    confidence: 0.9,
    pageId: `p-${pageNumber}`,
    pageNumber,
    rowOrderInPage: i + 1,
  })),
  totalsBySide: {
    sell:
      handwrittenSellTotal !== null
        ? {
            side: 'sell',
            handwritten_total_amount: handwrittenSellTotal,
            handwritten_total_weight_g: handwrittenSellWeightG ?? rowsCount * 5,
            confidence: 0.95,
          }
        : null,
    buy: null,
  },
  redMarks: [],
  readStatus: 'done',
  importStatus: 'pending',
});

test('H1.8: groups 6 pages (2 days, one with continuation, plus blank & cover pages) into 2 valid days', () => {
  const pages: ScannedLedgerPage[] = [
    makeMockPage(1, 'cover', null, 0),
    makeMockPage(2, 'day_start', '2026-04-11', 3),
    makeMockPage(3, 'continuation', null, 2, 5 * 19000, 5 * 5), // continuation of 2026-04-11
    makeMockPage(4, 'blank', null, 0),
    makeMockPage(5, 'day_start', '2026-04-12', 4, 4 * 19000, 4 * 5),
    makeMockPage(6, 'blank', null, 0),
  ];

  const days = groupPagesIntoDays(pages);
  assert.equal(days.length, 2);

  assert.equal(days[0].date, '2026-04-11');
  assert.deepEqual(days[0].pageNumbers, [2, 3]);
  assert.equal(days[0].rows.length, 5);
  assert.equal(days[0].totalsMatch.sell.status, 'match');
  assert.equal(days[0].totalsMatch.sell.diffAmount, 0);

  assert.equal(days[1].date, '2026-04-12');
  assert.deepEqual(days[1].pageNumbers, [5]);
  assert.equal(days[1].rows.length, 4);
  assert.equal(days[1].totalsMatch.sell.status, 'match');
});

test('H1.3: flags an orphan continuation page at the start of the file', () => {
  const pages: ScannedLedgerPage[] = [
    makeMockPage(1, 'continuation', null, 2),
    makeMockPage(2, 'day_start', '2026-04-11', 3),
  ];

  const days = groupPagesIntoDays(pages);
  assert.equal(days.length, 2);
  assert.equal(days[0].isOrphanContinuation, true);
  assert.equal(days[1].isOrphanContinuation, false);
});

test('H1.4: validates date sequences (gaps excluding Friday, duplicate dates, implausible years)', () => {
  // 2026-04-09 is Thursday, 2026-04-10 is Friday, 2026-04-11 is Saturday -> no gap alert for Friday!
  const pagesNoGap: ScannedLedgerPage[] = [
    makeMockPage(1, 'day_start', '2026-04-09', 2),
    makeMockPage(2, 'day_start', '2026-04-11', 2),
  ];
  const daysNoGap = groupPagesIntoDays(pagesNoGap, { excludeFridays: true });
  const gapWarnings = daysNoGap.flatMap((d) =>
    d.sequenceWarnings.filter((w) => w.type === 'gap')
  );
  assert.equal(gapWarnings.length, 0);

  // Implausible year (e.g. 2019) + Duplicate date
  const pagesIssues: ScannedLedgerPage[] = [
    makeMockPage(1, 'day_start', '2019-04-11', 2),
    makeMockPage(2, 'day_start', '2026-04-12', 2),
    makeMockPage(3, 'day_start', '2026-04-12', 2),
  ];
  const daysIssues = groupPagesIntoDays(pagesIssues);
  const allWarnings = daysIssues.flatMap((d) => d.sequenceWarnings);
  assert.ok(allWarnings.some((w) => w.type === 'implausible_year'));
  assert.ok(allWarnings.some((w) => w.type === 'duplicate_date'));
});

test('H3.5: ranks suspect rows explaining the exact difference with handwritten total', () => {
  const page = makeMockPage(1, 'day_start', '2026-04-15', 3, 2 * 19000);
  // Sum of 3 rows = 57,000, handwritten = 38,000 -> diff = +19,000 (exact match to a 19,000 row)
  const suspects = rankSuspectRowsForDiff(page.rows, 'sell', 19000, 5, 3800);
  assert.ok(suspects.length > 0);
  assert.equal(suspects[0].row.total, 19000);
});
