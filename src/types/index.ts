export type OperationKind = 'buy' | 'sell' | 'expense' | 'advance' | 'person';

export type PaymentType = 'cash' | 'credit';

export type PersonDirection = 'gave_him' | 'received_from_him';

export type GoldKarat = 18 | 21 | 24 | 'other';

export type LedgerPageKind = 'day_start' | 'continuation' | 'blank' | 'cover' | 'unreadable';

export type LedgerPageSide = 'buy' | 'sell' | 'both';

export type RedMarkType =
  | 'circle'
  | 'tick'
  | 'underline'
  | 'strike'
  | 'number'
  | 'text'
  | 'other';

export interface RedMarkItem {
  id?: string;
  type: RedMarkType;
  row_hint?: number | string | null;
  text?: string;
  confidence: number;
  suggestedCorrectionValue?: number;
}

export interface HandwrittenSideTotals {
  side: 'buy' | 'sell';
  handwritten_total_amount: number | null;
  handwritten_total_weight_g: number | null;
  closing_balance?: number | null;
  candidates?: number[];
  location_hint?: string;
  confidence: number;
}

export interface SideTotalsComparison {
  readSumAmount: number;
  readSumWeightG: number;
  handwrittenAmount?: number | null;
  handwrittenWeightG?: number | null;
  approvedAmount?: number | null;
  approvedWeightG?: number | null;
  candidates?: number[];
  status: 'match' | 'small_diff' | 'large_diff' | 'missing';
  diffAmount: number;
  diffWeightG: number;
  approvedByAuditor?: boolean;
}

export type SalesSourceBucket = 'rayon' | 'bag' | 'old_gold' | 'other';

export interface SourceBucketRuleConfig {
  id: SalesSourceBucket;
  name: string;
  trackingUnit: 'pieces' | 'weight' | 'both';
  color: string;
  keywords: string[];
  toleranceG: number;
}

export interface LedgerPageRegion {
  id: string;
  label: string;
  side: 'buy' | 'sell' | 'both';
  blockIndex?: 1 | 2; // H-C: 1 = Right block, 2 = Left block
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
}

export interface SourcePageRef {
  pageIndex: number; // 1-indexed page in file or day
  pdfPage?: number; // H5.1: 1-indexed page in original PDF/file
  fileName?: string; // H5.1: Original file name
  importBatchId?: string; // H5.1: Import batch ID
  pageImageKey?: string; // e.g. '2026-10-27__p1' or '2026-10-27'
  rowYRatio?: number; // 0..1 vertical position on the page
  yTop?: number; // H5.1: 0..1 top of row bounding box
  yBottom?: number; // H5.1: 0..1 bottom of row bounding box
  bbox?: { x: number; y: number; w: number; h: number }; // H5.1: bounding box on sheet
  side?: 'buy' | 'sell';
  sheetSide?: 'buy' | 'sell'; // H5.1 & H-A: 'sell' (right) or 'buy' (left)
  sheetIndexInDay?: number; // H5.1: 1 for first sheet in day, 2, 3... for continuations
  blockIndex?: 1 | 2; // H-C: 1 = Right block (الكتلة اليمنى), 2 = Left block (الكتلة اليسرى)
  lineInBlock?: number; // H-C: 1-based ruled line number inside the block (including empty lines)
  lineNo?: number; // H5.1: 1-based line number on the sheet
  seq?: number; // H-C: Sequential order in sheet = lineInBlock for block 1, linesPerBlock + lineInBlock for block 2
}

export interface FreeAreaNote {
  id: string;
  text: string;
  numericValue?: number | null;
  suggestedCategory: 'sum' | 'subtract' | 'balance' | 'note';
  matchedField?:
    | 'sell_total'
    | 'buy_total'
    | 'sell_weight'
    | 'buy_weight'
    | 'net_cash'
    | 'net_weight'
    | 'safe_balance'
    | null;
  confidence: number;
  locationHint?: string;
}

export interface RedOtherItem {
  id: string;
  text: string;
  numericValue?: number | null;
  category: 'total' | 'correction' | 'note' | 'unclassified';
  confidence: number;
  locationHint?: string;
}

export interface CashMovementSuspect {
  id: string;
  text: string;
  amount: number;
  pageNumber: number;
  blockIndex?: 1 | 2;
  lineInBlock?: number;
  confidence: number;
  classification: 'unclassified' | 'sell' | 'person' | 'expense' | 'advance' | 'ignore';
  personId?: string;
  workerId?: string;
  expenseCategory?: string;
}

export interface BucketDailyReconciliation {
  beforeG?: number;
  beforeManual?: boolean;
  autoInflowG?: number; // H-B.4: Auto inflow (e.g. scrap purchases for old_gold)
  autoInflowConfirmed?: boolean;
  manualInflowG?: number;
  soldG?: number;
  actualG?: number;
  piecesBefore?: number;
  piecesInflow?: number;
  piecesSold?: number;
  piecesActual?: number;
}

export interface Operation {
  id: string;
  date: string; // YYYY-MM-DD
  kind: OperationKind;
  karat?: GoldKarat; // Fix A.1: Optional karat (18 / 21 / 24 / other), default 21
  weightG: number; // Weight in grams (with decimals, e.g. 12.350)
  total: number; // Total amount in EGP
  item?: string; // Statement / Item description
  payment: PaymentType; // default 'cash'
  personId?: string; // For credit buy/sell or person transactions
  workerId?: string; // For worker advances
  direction?: PersonDirection; // For kind === 'person': gave_him vs received_from_him
  category?: string; // For expenses
  reviewedFlag: boolean;
  note: string;
  importBatchId?: string; // G3: Batch ID if imported
  sourceType?: string; // G3: 'manual' | 'excel' | 'csv' | 'pdf' | 'ocr' | 'docx' | 'html' | 'json' | 'clipboard'
  // H4: Running balance columns from paper ledger
  runningBalanceBefore?: number;
  runningBalanceAfter?: number;
  // H9: Running safe balance from Sales sheet
  bookRunningCash?: number;
  pageNumberHint?: string | number;
  rowOrderInPage?: number;
  ocrConfidence?: number;
  // H5 (البديل): Red circled number = number of pieces sold from Rayon
  pieces?: number;
  piecesConfidence?: number;
  // H7 & H-B: Sales source bucket ('rayon' | 'bag' | 'old_gold' | 'other')
  sourceBucket?: SalesSourceBucket;
  sourceHint?: string;
  sourceGuessed?: boolean;
  multiSourceWarning?: boolean;
  // H5: Paper ledger red ink marks linked to this row (separate from reviewedFlag)
  bookMarks?: RedMarkItem[];
  // P5 & H5.1 & H-C: Full source reference to sheet, block, and line
  sourcePageRef?: SourcePageRef;
  createdAt: number;
  updatedAt: number;
}

export interface DayChecklist {
  cashVerified: boolean;
  balancesMatched: boolean;
  advancesChecked: boolean;
  debtsChecked: boolean;
  goldInventoryChecked: boolean;
  visitedAt?: string;
}

export interface KaratBalanceEntry {
  openingG?: number;
  openingManual?: boolean;
  closingG?: number;
}

export type KaratKey = '18' | '21' | '24' | 'other';

export interface DayLedgerPageMeta {
  pageIndex: number;
  imageKey: string;
  side?: LedgerPageSide;
  kind?: LedgerPageKind;
  pageNumberHint?: string;
  dataUrl?: string;
}

export interface DayInfo {
  date: string; // YYYY-MM-DD
  goldPricePerGram: number; // Mandatory 21K base price (0 if not yet entered)
  goldPrice18?: number; // Auto-calculated (goldPricePerGram * 18 / 21) or manually overridden
  goldPrice24?: number; // Auto-calculated (goldPricePerGram * 24 / 21) or manually overridden
  goldPriceOther?: number; // Optional custom price for 'other' karat
  priceConfirmed?: boolean; // Fix A.4: True once user enters/confirms the day's gold price
  openingBalanceG?: number;
  openingBalanceManual?: boolean;
  closingBalanceG?: number;
  // F4: Karat-by-karat gold inventory balances
  karatBalances?: Partial<Record<KaratKey, KaratBalanceEntry>>;
  openingCash?: number;
  openingCashManual?: boolean;
  actualCash?: number;
  cashNote?: string;
  goldNote?: string;
  locked: boolean;
  unlockReason?: string;
  ledgerImageDataUrl?: string; // Loaded on demand in runtime
  ledgerImageFile?: string; // Filename in data/images/<date>.jpg
  // H1/H3/H4: Handwritten ledger balances & totals comparison
  openingLedgerBalance?: number;
  closingLedgerBalance?: number;
  // H9: Safe balance read from Sales sheet (Right sheet)
  bookOpeningCash?: number;
  bookClosingCash?: number;
  // H7 & H-B: End-of-day inventory reconciliation per source bucket (Rayon / Bag / Old Gold / Other)
  bucketReconciliation?: Partial<Record<SalesSourceBucket, BucketDailyReconciliation>>;
  // H-C.3: Handwritten calculations/notes in the free area at the end of the day
  freeAreaNotes?: FreeAreaNote[];
  // H10.5: Reason recorded when locking a day that has a difference above tolerance
  lockWithDiffReason?: string;
  ledgerTotalsComparison?: {
    sell?: SideTotalsComparison;
    buy?: SideTotalsComparison;
  };
  // P5: Ordered list of compressed ledger pages attached to this day
  ledgerPages?: DayLedgerPageMeta[];
  checklist?: DayChecklist;
}

export type PersonType = 'client' | 'supplier' | 'worker' | 'other';

export interface PersonFollowUp {
  id: string;
  date: string; // YYYY-MM-DD
  note: string;
  promisedDate?: string; // YYYY-MM-DD
  promisedAmount?: number;
  createdAt: number;
}

export interface Person {
  id: string;
  name: string;
  type: PersonType;
  phone?: string;
  note?: string;
  // F2: Advanced Debt Management
  maxDebtCash?: number; // Maximum allowed cash debt (EGP)
  maxDebtGoldG?: number; // Optional maximum allowed gold debt (grams)
  agreedDueDate?: string; // Agreed repayment date (YYYY-MM-DD), auto-updated with new promise
  followUps?: PersonFollowUp[]; // Follow-up & repayment promise history
  createdAt: number;
}

export interface Worker {
  id: string;
  name: string;
  monthlySalary: number;
  dueDay: number; // default 30
  note?: string;
  carryOverDiff?: number; // Carried over balance from previous month close
  createdAt: number;
}

export type AuditActionType =
  | 'add'
  | 'batch_add'
  | 'edit'
  | 'delete'
  | 'undo_add'
  | 'undo_delete'
  | 'review_note'
  | 'lock'
  | 'unlock'
  | 'salary_close'
  | 'visit_complete'
  | 'price_edit'
  | 'person_merge'
  | 'permanent_delete'
  | 'fix_it'
  | 'export'
  | 'print'
  | 'import_batch'
  | 'rollback_batch'
  | 'snapshot_undo'
  | 'quarantine_restore'
  | 'red_circle_to_reviewed';

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  action: AuditActionType;
  rowId?: string;
  date: string;
  kind?: OperationKind;
  description: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  wasLocked?: boolean; // Fix B.3: Lock state of the day AT THE TIME of the action
}

export type IssueSeverity = 'high' | 'medium' | 'low';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  checkType: string;
  checkTitle: string;
  rowId?: string;
  date: string;
  kind?: OperationKind;
  personId?: string;
  workerId?: string;
  message: string;
  expected?: string | number;
  actual?: string | number;
  difference?: string | number;
}

export interface IssueReviewState {
  reviewed: boolean;
  note: string;
}

export type SensitivityPreset = 'strict' | 'medium' | 'lenient' | 'custom';

export interface FixedRulesConfig {
  enabled: boolean;
  sellBelowDailyByAmount: number; // e.g., 30 EGP below daily gold price
  buyAboveDailyByAmount: number;  // e.g., 50 EGP above daily gold price
}

export interface AllowedPriceRangeConfig {
  sellMinBelowDaily: number;    // X: default 0 EGP (selling below daily price - X is flagged)
  sellMaxMakingCharge: number;  // Y: default 400 EGP/g max normal making charge (مصنعية)
  buyMaxDiscount: number;       // Z: default 300 EGP/g max normal scrap discount (خصم كسر)
}

export interface AuditExceptions {
  items: string[];
  personIds: string[];
  dates: string[];
}

export type ShortSpaceWeightMode = 'ask' | 'decimal' | 'milli';

export interface LedgerArithmeticTemplateConfig {
  enabled: boolean;
  sellDirection: 'add' | 'subtract'; // How sell operation affects running balance
  buyDirection: 'add' | 'subtract';  // How buy operation affects running balance
  checkWeightAndCount: boolean;
}

export interface AuditSettings {
  sensitivityPreset: SensitivityPreset;
  priceDiffMediumPct: number; // default 1.5% beyond allowed range
  priceDiffHighPct: number;   // default 3.0% beyond allowed range
  allowedPriceRange: AllowedPriceRangeConfig; // Fix A.2
  robustZThreshold: number;   // default 3.5
  maxReasonableWeightG: number; // default 500g
  goldBalanceToleranceG: number; // default 0.5g
  // F4: Karat tolerances and combined mode toggle
  karatToleranceG?: Record<KaratKey, number>;
  combinedGoldInventory?: boolean;
  cashDiscrepancyThreshold: number; // default 200 EGP
  workerAdvanceMediumPct: number; // default 50%
  workerAdvanceHighPct: number;   // default 100%
  expenseSpikeMultiplier: number; // default 3x
  personOverdueMediumDays: number; // default 30 days
  personOverdueHighDays: number;   // default 90 days
  goldDormantDays: number;         // default 30 days
  excludeFridays: boolean;         // default true
  dateFormatOrder: 'DMY' | 'MDY';  // default 'DMY'
  shortSpaceWeightMode: ShortSpaceWeightMode; // Fix C.13: 'ask' | 'decimal' | 'milli'
  fixedRules: FixedRulesConfig;
  exceptions: AuditExceptions;
  enableAiSummaryButton: boolean;
  shopName: string; // Fix A.5: default ''
  auditorName: string;
  // Desktop / Electron settings
  geminiModel?: string; // Default 'gemini-3.8-flash'
  disablePhotoUpload?: boolean; // Completely hide and block photo upload
  externalBackupPath?: string; // Path to USB drive / cloud folder
  lastExternalBackupAt?: number; // Timestamp of last external folder sync
  onboardingCompleted?: boolean; // Whether first-run quick setup was completed
  includePersonDataInExports?: boolean; // G2.7: Default true for auditor
  // H3: Handwritten ledger total matching tolerances
  ledgerTotalSmallDiffAmount?: number; // default 50 EGP
  ledgerTotalLargeDiffAmount?: number; // default 200 EGP
  ledgerTotalWeightToleranceG?: number; // default 0.25 g
  // H4: Paper ledger arithmetic template config
  ledgerArithmeticTemplate?: LedgerArithmeticTemplateConfig;
  // H5: Manual option to convert red circle marks to reviewedFlag
  convertRedCircleToReviewed?: boolean;
  // H2.7 / P5: Retain scanned ledger pages with the day
  retainScannedPagesWithDay?: boolean;
  // H3.6 & P3: Additional toggles
  blockImportOnUnapprovedLargeDiff?: boolean;
  enableSelfLearningDictionary?: boolean;
  // H-A: Sheet layout orientation (default false = Right is Sales, Left is Purchases)
  reverseLedgerSheetLayout?: boolean;
  // H-C: Number of ruled lines per block in the ledger sheet (default 25)
  ledgerLinesPerBlock?: number;
  // H5.2: Items that normally require piece counts when sold from Rayon
  itemsExpectingPieces?: string[];
  // H7 & H-B: Sales source buckets configuration & keyword toggles
  sourceBucketsConfig?: Record<SalesSourceBucket, SourceBucketRuleConfig>;
  includeStandaloneKasrForOldGold?: boolean;
  autoAddScrapPurchasesToOldGoldInflow?: boolean;
  // H9.4 & H10.6: How purchases affect the paper ledger's safe balance
  purchasesSafeBalanceImpact?: 'deduct_per_row' | 'deduct_end_of_day' | 'no_impact';
  // H10.4: Rule mode for "Gold cannot be sold more than available"
  goldAvailabilityRuleMode?: 'with_opening' | 'strict_daily';
}

export interface BackupFileInfo {
  name: string;
  createdAt: number;
  sizeBytes: number;
  operationsCount: number;
  schemaVersion: number;
}

export type PriceThresholdMethod =
  | 'shop_rules'
  | 'fixed'
  | 'daily_diff_pct'
  | 'daily_diff_amount'
  | 'weighted_avg_pct';

export interface PriceStatementPreset {
  id: string;
  name: string;
  kindFilter: 'buy' | 'sell' | 'both';
  thresholdMethod: PriceThresholdMethod;
  higherThanVal: string;
  lowerThanVal: string;
  itemFilter: string;
  personIdFilter: string;
  minWeightG: string;
  excludeCompoundItems: boolean;
  useLastKnownGoldPrice: boolean;
}

// F7: Recycle Bin Entry
export interface DeletedOperationEntry {
  id: string;
  operation: Operation;
  deletedAt: number;
  reason: string;
}

// F5: Audit Visit Mode & Final Report
export interface AuditVisitChecklist {
  pricesRecorded: boolean;
  highIssuesReviewed: boolean;
  safeVerified: boolean;
  goldInventoryVerified: boolean;
  sourceBucketsMatched?: boolean; // H7.5: Source buckets reconciliation step
  dayCloseVerified?: boolean; // H10.6: End-of-day cash & weight close step
  debtsMatched: boolean;
  advancesReviewed: boolean;
  expensesReviewed: boolean;
}

export interface AuditVisitSummarySnapshot {
  buyG: number;
  buyTotal: number;
  sellG: number;
  sellTotal: number;
  expensesTotal: number;
  advancesTotal: number;
  netSafeDiff: number;
  netGoldDiff21EqG: number;
  totalDebtsOwesUs: number;
  totalDebtsOverdue: number;
  highIssuesCount: number;
  mediumIssuesCount: number;
  lowIssuesCount: number;
  unreviewedHighCount: number;
  sellAnomaliesImpact: number;
  buyAnomaliesImpact: number;
  // H3.7 & H5.6: Ledger totals diff & red marks summary in final visit report
  ledgerTotalsNetSellDiff?: number;
  ledgerTotalsNetBuyDiff?: number;
  redMarksCount?: number;
}

export interface AuditVisit {
  id: string;
  name: string;
  fromDate: string;
  toDate: string;
  notes: string;
  recommendations: string;
  checklist: AuditVisitChecklist;
  status: 'in_progress' | 'completed';
  createdAt: number;
  completedAt?: number;
  summarySnapshot?: AuditVisitSummarySnapshot;
}

// G1.2: Diagnostic Error Log Record
export interface DiagnosticErrorLog {
  id: string;
  timestamp: number;
  date: string; // YYYY-MM-DD
  screen: string;
  code: string;
  severity: 'error' | 'warn' | 'info';
  title: string;
  message: string;
  hint?: string;
  stack?: string;
}

// G1.4: Quarantined Record
export interface QuarantinedRecord {
  id: string;
  entityType: 'operation' | 'person' | 'worker' | 'dayInfo';
  rawData: any;
  reason: string;
  quarantinedAt: number;
}

// G1.6: Pre-Operation Safety Snapshot (10-minute Undo)
export interface SafetySnapshot {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  statePayload: {
    operations: Operation[];
    deletedOperations: DeletedOperationEntry[];
    daysMap: Record<string, DayInfo>;
    persons: Person[];
    workers: Worker[];
    closedSalaryMonths: string[];
  };
}

// G2.1: Unified FilterBar State & Presets
export interface UnifiedFilterState {
  fromDate: string;
  toDate: string;
  datePreset: 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'last_30' | 'custom';
  kinds: OperationKind[];
  karats: GoldKarat[];
  itemQuery: string;
  personId: string;
  workerId: string;
  minWeight: string;
  maxWeight: string;
  minTotal: string;
  maxTotal: string;
  minGramPrice: string;
  maxGramPrice: string;
  severities: IssueSeverity[];
  reviewState: 'all' | 'reviewed' | 'unreviewed';
  paymentType: 'all' | 'cash' | 'credit';
  dayLockState: 'all' | 'locked' | 'open';
  searchQuery: string;
  // H5.3: Filter by paper ledger red marks
  bookMarkState?: 'all' | 'has_mark' | 'no_mark' | 'red_number_diff';
  // H7.5: Filter by sales source bucket
  sourceBuckets?: SalesSourceBucket[];
}

export interface SavedFilterPreset {
  id: string;
  name: string;
  screenId: string;
  filter: UnifiedFilterState;
  createdAt: number;
}

// G3.7: Import Batch History & Templates
export interface ImportBatchRecord {
  id: string;
  sourceName: string;
  sourceType: string;
  fileSha?: string;
  importedAt: number;
  operationsCount: number;
  totalWeightG: number;
  totalAmount: number;
  dates: string[];
  attachedFileRef?: string;
  rolledBack?: boolean;
  // H5.6: Saved red marks & H3 totals summary for batch reference
  redMarksSummary?: RedMarkItem[];
  ledgerTotalsDiffSummary?: {
    date: string;
    sellDiffAmount: number;
    buyDiffAmount: number;
  }[];
}

export interface ImportMappingTemplate {
  id: string;
  name: string;
  colMap: {
    dateCol: number;
    kindCol: number;
    karatCol: number;
    weightCol: number;
    milliCol: number;
    totalCol: number;
    gramPriceCol: number;
    itemCol: number;
    personCol: number;
    paymentCol: number;
    dailyGoldPriceCol: number;
    noteCol: number;
  };
  explicitKind?: 'buy' | 'sell' | '';
  defaultKarat?: GoldKarat;
  dateFormatOrder?: 'DMY' | 'MDY';
  createdAt: number;
}

