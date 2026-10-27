export type OperationKind = 'buy' | 'sell' | 'expense' | 'advance' | 'person';

export type PaymentType = 'cash' | 'credit';

export type PersonDirection = 'gave_him' | 'received_from_him';

export type GoldKarat = 18 | 21 | 24 | 'other';

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
  | 'quarantine_restore';

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

