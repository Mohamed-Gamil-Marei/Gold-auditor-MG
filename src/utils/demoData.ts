import {
  AuditLogEntry,
  DayInfo,
  Operation,
  Person,
  Worker,
} from '../types';
import { getTodayIso } from './numerals';

/**
 * Demo dataset emptied as requested while preserving the module contract and types.
 */
export function generateDemoDataset(): {
  operations: Operation[];
  daysMap: Record<string, DayInfo>;
  persons: Person[];
  workers: Worker[];
  auditLogs: AuditLogEntry[];
} {
  const today = getTodayIso();
  return {
    operations: [],
    daysMap: {
      [today]: {
        date: today,
        goldPricePerGram: 0,
        priceConfirmed: false,
        locked: false,
      },
    },
    persons: [],
    workers: [],
    auditLogs: [],
  };
}
