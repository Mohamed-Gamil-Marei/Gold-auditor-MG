import { DayInfo } from '../../types';
import { getEffectiveKaratPrice } from '../../utils/numerals';
import { NormalizedImportRow } from './normalizeRow';

export type ImportRowHealth = 'ok' | 'warn' | 'error';

export interface ValidatedImportRow extends NormalizedImportRow {
  id: string;
  selected: boolean;
  health: ImportRowHealth;
  issues: string[];
  isDuplicate: boolean;
  duplicateOfId?: string;
}

export function validateNormalizedRows(
  rows: NormalizedImportRow[],
  daysMap: Record<string, DayInfo>
): ValidatedImportRow[] {
  return rows.map((row, idx) => {
    const issues: string[] = [...row.normalizationNotes];
    let health: ImportRowHealth = 'ok';

    const markWarn = (msg: string) => {
      issues.push(msg);
      if (health === 'ok') health = 'warn';
    };
    const markError = (msg: string) => {
      issues.push(msg);
      health = 'error';
    };

    // Date check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      markError('صيغة التاريخ غير صالحة');
    } else {
      const year = Number(row.date.slice(0, 4));
      if (year < 2015 || year > 2035) {
        markWarn(`سنة التاريخ (${year}) تبدو غير معتادة`);
      }
    }

    // Buy / Sell checks
    if (row.kind === 'buy' || row.kind === 'sell') {
      if (row.weightG <= 0) {
        markError('الوزن مفقود أو يساوي صفراً لعملية بيع/شراء');
      } else if (row.weightG > 1000) {
        markWarn(`الوزن (${row.weightG} جم) كبير جداً — تحقق من الفاصلة العشرية`);
      }

      if (row.total <= 0) {
        markError('إجمالي المبلغ مفقود أو يساوي صفراً');
      }

      // Check implied gram price vs day gold price
      if (row.weightG > 0 && row.total > 0) {
        const impliedPrice = row.total / row.weightG;
        const dayInfo = daysMap[row.date];
        const expectedRef =
          getEffectiveKaratPrice(dayInfo, row.karat) || row.dailyGoldPrice || 0;

        if (expectedRef > 0) {
          const ratio = impliedPrice / expectedRef;
          if (ratio > 3.5 || ratio < 0.25) {
            markWarn(
              `سعر الجرام الضمني (${Math.round(impliedPrice)}) يبعد كثيراً عن سعر اليوم (${Math.round(
                expectedRef
              )})`
            );
          }
        } else if (impliedPrice < 400 || impliedPrice > 25000) {
          markWarn(`سعر الجرام الضمني (${Math.round(impliedPrice)} ج.م) خارج النطاق المعتاد`);
        }
      }
    } else {
      // Expense, advance, person
      if (row.total <= 0 && row.weightG <= 0) {
        markError(`المبلغ مطلوب لعملية (${row.kind})`);
      }
      if (row.kind === 'person' && !row.personName.trim()) {
        markWarn('يُفضل تحديد اسم الشخص لحركة الحساب');
      }
      if (row.kind === 'advance' && !row.personName.trim() && !row.item.trim()) {
        markWarn('يُفضل تحديد اسم العامل للسلفة');
      }
    }

    // Empty row check
    if (row.weightG <= 0 && row.total <= 0 && !row.item && !row.personName && !row.note) {
      markError('صف فارغ بالكامل');
    }

    return {
      ...row,
      id: `imp-row-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      selected: (health as ImportRowHealth) !== 'error',
      health: health as ImportRowHealth,
      issues,
      isDuplicate: false,
    };
  });
}
