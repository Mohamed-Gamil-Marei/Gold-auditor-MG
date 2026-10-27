import { AuditLogEntry, DayInfo, Issue } from '../../types';
import { toLocalIso } from '../numerals';

/**
 * Fix B.3:
 * Uses `log.wasLocked` (the lock state at the exact time the edit/delete occurred)
 * instead of `daysMap[log.date]?.locked` so normal edits made BEFORE locking a day
 * never appear as high-severity locked-day violations after locking.
 */
export function checkAuditLogAnomalies(
  auditLogs: AuditLogEntry[],
  _daysMap: Record<string, DayInfo>
): Issue[] {
  const issues: Issue[] = [];

  for (const log of auditLogs) {
    if (log.action === 'unlock') {
      issues.push({
        id: `audit-unlock-${log.id}`,
        severity: 'high',
        checkType: 'audit_log_anomaly',
        checkTitle: 'تعديل متأخر أو في يوم مقفول',
        date: log.date,
        message: `تم فتح قفل يوم مقفول (${log.date}) لإجراء تعديلات — السبب المسجل: "${
          log.reason || 'بدون سبب'
        }".`,
        expected: 'بقاء اليوم مقفولاً بعد المراجعة',
        actual: 'تم فتح القفل وتعديله',
      });
      continue;
    }

    if (
      log.action !== 'edit' &&
      log.action !== 'delete' &&
      log.action !== 'undo_add' &&
      log.action !== 'undo_delete'
    ) {
      continue;
    }

    const logDateIso = toLocalIso(new Date(log.timestamp));
    const opTime = new Date(`${log.date}T00:00:00Z`).getTime();
    const editTime = new Date(`${logDateIso}T00:00:00Z`).getTime();
    const diffDays = Math.floor((editTime - opTime) / 86400000);

    if (log.wasLocked) {
      issues.push({
        id: `audit-locked-edit-${log.id}`,
        severity: 'high',
        checkType: 'audit_log_anomaly',
        checkTitle: 'تعديل متأخر أو في يوم مقفول',
        rowId: log.rowId,
        date: log.date,
        kind: log.kind,
        message: `${
          log.action === 'delete' ? 'حذف' : 'تعديل'
        } صف أثناء حالة قفل اليوم (${log.date}): ${log.description} — السبب: "${
          log.reason || 'غير مذكور'
        }".`,
        expected: log.oldValue || 'القيمة الأصلية',
        actual: log.newValue || 'محذوف',
      });
    } else if (diffDays >= 1) {
      issues.push({
        id: `audit-late-edit-${log.id}`,
        severity: 'medium',
        checkType: 'audit_log_anomaly',
        checkTitle: 'تعديل متأخر أو في يوم مقفول',
        rowId: log.rowId,
        date: log.date,
        kind: log.kind,
        message: `${
          log.action === 'delete' ? 'حذف' : 'تعديل'
        } متأخر بعد ${diffDays} يوم على عملية بتاريخ ${log.date}: ${
          log.description
        } — السبب: "${log.reason || 'غير مذكور'}".`,
        expected: log.oldValue || 'القيمة الأصلية',
        actual: log.newValue || 'محذوف',
        difference: `بعد ${diffDays} يوم`,
      });
    }
  }

  return issues;
}
