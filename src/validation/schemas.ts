import { z } from 'zod';
import {
  AuditLogEntry,
  AuditSettings,
  DayInfo,
  Operation,
  Person,
  QuarantinedRecord,
  Worker,
} from '../types';

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const OperationSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(isoDateRegex, 'صيغة التاريخ يجب أن تكون YYYY-MM-DD'),
  kind: z.enum(['buy', 'sell', 'expense', 'advance', 'person']),
  karat: z.union([z.literal(18), z.literal(21), z.literal(24), z.literal('other')]).optional(),
  weightG: z.number().finite('الوزن يجب أن يكون رقماً صالحاً').min(0, 'الوزن لا يمكن أن يكون سالباً').max(50000, 'الوزن يتجاوز الحد المنطقي'),
  total: z.number().finite('المبلغ يجب أن يكون رقماً صالحاً').min(0, 'المبلغ لا يمكن أن يكون سالباً').max(500_000_000, 'المبلغ يتجاوز الحد المنطقي'),
  item: z.string().optional().default(''),
  payment: z.enum(['cash', 'credit']).default('cash'),
  personId: z.string().optional(),
  workerId: z.string().optional(),
  direction: z.enum(['gave_him', 'received_from_him']).optional(),
  category: z.string().optional(),
  reviewedFlag: z.boolean().default(false),
  note: z.string().default(''),
  importBatchId: z.string().optional(),
  sourceType: z.string().optional(),
  createdAt: z.number().finite().optional().default(() => Date.now()),
  updatedAt: z.number().finite().optional().default(() => Date.now()),
});

export const PersonFollowUpSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(isoDateRegex),
  note: z.string(),
  promisedDate: z.string().optional(),
  promisedAmount: z.number().finite().optional(),
  createdAt: z.number().finite(),
});

export const PersonSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'اسم الشخص مطلوب'),
  type: z.enum(['client', 'supplier', 'worker', 'other']).default('client'),
  phone: z.string().optional(),
  note: z.string().optional(),
  maxDebtCash: z.number().finite().nonnegative().optional(),
  maxDebtGoldG: z.number().finite().nonnegative().optional(),
  agreedDueDate: z.string().optional(),
  followUps: z.array(PersonFollowUpSchema).optional(),
  createdAt: z.number().finite().optional().default(() => Date.now()),
});

export const WorkerSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'اسم العامل مطلوب'),
  monthlySalary: z.number().finite().nonnegative('المرتب لا يمكن أن يكون سالباً'),
  dueDay: z.number().int().min(1).max(31).default(30),
  note: z.string().optional(),
  carryOverDiff: z.number().finite().optional(),
  createdAt: z.number().finite().optional().default(() => Date.now()),
});

export const DayInfoSchema = z.object({
  date: z.string().regex(isoDateRegex, 'تاريخ اليومية غير صالح'),
  goldPricePerGram: z.number().finite().min(0).max(500000),
  goldPrice18: z.number().finite().min(0).max(500000).optional(),
  goldPrice24: z.number().finite().min(0).max(500000).optional(),
  goldPriceOther: z.number().finite().min(0).max(500000).optional(),
  priceConfirmed: z.boolean().optional(),
  openingBalanceG: z.number().finite().optional(),
  openingBalanceManual: z.boolean().optional(),
  closingBalanceG: z.number().finite().optional(),
  karatBalances: z.record(z.string(), z.any()).optional(),
  openingCash: z.number().finite().optional(),
  openingCashManual: z.boolean().optional(),
  actualCash: z.number().finite().optional(),
  cashNote: z.string().optional(),
  goldNote: z.string().optional(),
  locked: z.boolean().default(false),
  unlockReason: z.string().optional(),
  ledgerImageDataUrl: z.string().optional(),
  ledgerImageFile: z.string().optional(),
  checklist: z.any().optional(),
});

export const AuditLogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().finite(),
  action: z.string().min(1),
  rowId: z.string().optional(),
  date: z.string(),
  kind: z.enum(['buy', 'sell', 'expense', 'advance', 'person']).optional(),
  description: z.string(),
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
  reason: z.string().optional(),
  wasLocked: z.boolean().optional(),
});

export const AuditSettingsSchema = z.object({
  sensitivityPreset: z.enum(['strict', 'medium', 'lenient', 'custom']).default('medium'),
  priceDiffMediumPct: z.number().finite().positive().default(1.5),
  priceDiffHighPct: z.number().finite().positive().default(3.0),
  robustZThreshold: z.number().finite().positive().default(3.5),
  maxReasonableWeightG: z.number().finite().positive().default(500),
  goldBalanceToleranceG: z.number().finite().nonnegative().default(0.5),
  cashDiscrepancyThreshold: z.number().finite().nonnegative().default(200),
  workerAdvanceMediumPct: z.number().finite().nonnegative().default(50),
  workerAdvanceHighPct: z.number().finite().nonnegative().default(100),
  expenseSpikeMultiplier: z.number().finite().positive().default(3),
  personOverdueMediumDays: z.number().finite().positive().default(30),
  personOverdueHighDays: z.number().finite().positive().default(90),
  goldDormantDays: z.number().finite().positive().default(30),
  excludeFridays: z.boolean().default(true),
  dateFormatOrder: z.enum(['DMY', 'MDY']).default('DMY'),
  shortSpaceWeightMode: z.enum(['ask', 'decimal', 'milli']).default('ask'),
  shopName: z.string().default(''),
  auditorName: z.string().default('المراجع المالي'),
});

/**
 * Validates raw state arrays/maps with Zod and isolates any corrupted records into `quarantine`
 * without failing the entire state hydration.
 */
export function validateAndQuarantineState(rawState: any): {
  operations: Operation[];
  persons: Person[];
  workers: Worker[];
  daysMap: Record<string, DayInfo>;
  auditLogs: AuditLogEntry[];
  quarantined: QuarantinedRecord[];
} {
  const validOperations: Operation[] = [];
  const validPersons: Person[] = [];
  const validWorkers: Worker[] = [];
  const validDaysMap: Record<string, DayInfo> = {};
  const validLogs: AuditLogEntry[] = [];
  const quarantined: QuarantinedRecord[] = [];
  const now = Date.now();

  // Preserve previously quarantined records if present
  if (Array.isArray(rawState?.quarantinedRecords)) {
    quarantined.push(...rawState.quarantinedRecords);
  }

  // 1. Validate Operations
  if (Array.isArray(rawState?.operations)) {
    rawState.operations.forEach((rawOp: any, idx: number) => {
      // Coerce numeric strings if recoverable before quarantining
      const candidate =
        rawOp && typeof rawOp === 'object'
          ? {
              ...rawOp,
              weightG: typeof rawOp.weightG === 'string' ? Number(rawOp.weightG) : rawOp.weightG,
              total: typeof rawOp.total === 'string' ? Number(rawOp.total) : rawOp.total,
            }
          : rawOp;

      const parsed = OperationSchema.safeParse(candidate);
      if (parsed.success) {
        validOperations.push(parsed.data as Operation);
      } else {
        const firstIssue = parsed.error.issues[0];
        quarantined.push({
          id: `quar-op-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          entityType: 'operation',
          rawData: rawOp,
          reason: firstIssue
            ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
            : 'عملية تالفة أو تحتوي على قيم غير صالحة (NaN / تاريخ تالف)',
          quarantinedAt: now,
        });
      }
    });
  }

  // 2. Validate Persons
  if (Array.isArray(rawState?.persons)) {
    rawState.persons.forEach((rawP: any, idx: number) => {
      const parsed = PersonSchema.safeParse(rawP);
      if (parsed.success) {
        validPersons.push(parsed.data as Person);
      } else {
        const firstIssue = parsed.error.issues[0];
        quarantined.push({
          id: `quar-person-${now}-${idx}`,
          entityType: 'person',
          rawData: rawP,
          reason: firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'سجل شخص تالف',
          quarantinedAt: now,
        });
      }
    });
  }

  // 3. Validate Workers
  if (Array.isArray(rawState?.workers)) {
    rawState.workers.forEach((rawW: any, idx: number) => {
      const candidate =
        rawW && typeof rawW === 'object'
          ? {
              ...rawW,
              monthlySalary:
                typeof rawW.monthlySalary === 'string'
                  ? Number(rawW.monthlySalary)
                  : rawW.monthlySalary,
            }
          : rawW;
      const parsed = WorkerSchema.safeParse(candidate);
      if (parsed.success) {
        validWorkers.push(parsed.data as Worker);
      } else {
        const firstIssue = parsed.error.issues[0];
        quarantined.push({
          id: `quar-worker-${now}-${idx}`,
          entityType: 'worker',
          rawData: rawW,
          reason: firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'سجل عامل تالف',
          quarantinedAt: now,
        });
      }
    });
  }

  // 4. Validate DaysMap
  if (rawState?.daysMap && typeof rawState.daysMap === 'object') {
    for (const [dtKey, rawDay] of Object.entries<any>(rawState.daysMap)) {
      const candidate =
        rawDay && typeof rawDay === 'object'
          ? {
              ...rawDay,
              date: rawDay.date || dtKey,
              goldPricePerGram: Number(rawDay.goldPricePerGram) || 0,
            }
          : rawDay;
      const parsed = DayInfoSchema.safeParse(candidate);
      if (parsed.success) {
        validDaysMap[parsed.data.date] = parsed.data as DayInfo;
      } else {
        quarantined.push({
          id: `quar-day-${now}-${dtKey}`,
          entityType: 'dayInfo',
          rawData: rawDay,
          reason: `بيانات يومية (${dtKey}) غير صالحة`,
          quarantinedAt: now,
        });
      }
    }
  }

  // 5. Validate AuditLogs
  if (Array.isArray(rawState?.auditLogs)) {
    for (const rawLog of rawState.auditLogs) {
      const parsed = AuditLogEntrySchema.safeParse(rawLog);
      if (parsed.success) {
        validLogs.push(parsed.data as AuditLogEntry);
      }
    }
  }

  return {
    operations: validOperations,
    persons: validPersons,
    workers: validWorkers,
    daysMap: validDaysMap,
    auditLogs: validLogs,
    quarantined,
  };
}
