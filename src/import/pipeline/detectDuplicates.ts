import { ImportBatchRecord, Operation } from '../../types';
import { ValidatedImportRow } from './validateRow';

export interface DuplicateDetectionResult {
  rows: ValidatedImportRow[];
  duplicateCount: number;
  previousBatchMatch?: ImportBatchRecord;
}

export function detectDuplicatesInImport(
  rows: ValidatedImportRow[],
  existingOperations: Operation[],
  importBatches: ImportBatchRecord[],
  fileSha?: string
): DuplicateDetectionResult {
  const previousBatchMatch = fileSha
    ? importBatches.find((b) => !b.rolledBack && b.fileSha && b.fileSha === fileSha)
    : undefined;

  let duplicateCount = 0;

  const updatedRows: ValidatedImportRow[] = rows.map((row): ValidatedImportRow => {
    const match = existingOperations.find((op) => {
      if (op.date !== row.date || op.kind !== row.kind) return false;
      const weightMatch = Math.abs((op.weightG || 0) - (row.weightG || 0)) <= 0.005;
      const totalMatch = Math.abs((op.total || 0) - (row.total || 0)) <= 2;
      if (row.weightG > 0 && row.total > 0) {
        return weightMatch && totalMatch;
      }
      if (row.total > 0) {
        return totalMatch && (op.item || '') === (row.item || '');
      }
      return false;
    });

    if (match) {
      duplicateCount++;
      return {
        ...row,
        isDuplicate: true,
        duplicateOfId: match.id,
        selected: false,
        health: row.health === 'error' ? 'error' : 'warn',
        issues: [...row.issues, 'مكرر مع عملية مسجلة مسبقاً بنفس التاريخ والوزن والمبلغ'],
      };
    }

    return row;
  });

  return {
    rows: updatedRows,
    duplicateCount,
    previousBatchMatch,
  };
}
