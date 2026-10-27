import { DayInfo } from '../../types';
import { ValidatedImportRow } from './validateRow';

export interface DayConditionsReport {
  datesInBatch: string[];
  lockedDates: string[];
  datesMissingGoldPrice: string[];
}

export function checkImportDayConditions(
  rows: ValidatedImportRow[],
  daysMap: Record<string, DayInfo>
): DayConditionsReport {
  const activeRows = rows.filter((r) => r.selected && r.health !== 'error');
  const datesSet = new Set<string>();
  const rowHasGoldPriceForDate = new Set<string>();

  for (const r of activeRows) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      datesSet.add(r.date);
      if (r.dailyGoldPrice && r.dailyGoldPrice > 0) {
        rowHasGoldPriceForDate.add(r.date);
      }
    }
  }

  const datesInBatch = Array.from(datesSet).sort();
  const lockedDates: string[] = [];
  const datesMissingGoldPrice: string[] = [];

  for (const d of datesInBatch) {
    const info = daysMap[d];
    if (info?.locked) {
      lockedDates.push(d);
    }
    if (
      (!info || !info.goldPricePerGram || info.goldPricePerGram <= 0) &&
      !rowHasGoldPriceForDate.has(d)
    ) {
      datesMissingGoldPrice.push(d);
    }
  }

  return {
    datesInBatch,
    lockedDates,
    datesMissingGoldPrice,
  };
}
