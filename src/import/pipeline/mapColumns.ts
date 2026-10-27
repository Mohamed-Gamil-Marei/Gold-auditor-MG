import { ImportMappingTemplate } from '../../types';

export type ImportColumnMapping = ImportMappingTemplate['colMap'];

/**
 * G3.2 (Step 4): Auto-guesses Arabic and English column headers for the Universal Import pipeline.
 */
export function autoGuessColumnMapping(
  headers: string[],
  sampleRows: string[][] = []
): ImportColumnMapping {
  const mapping: ImportColumnMapping = {
    dateCol: -1,
    kindCol: -1,
    karatCol: -1,
    weightCol: -1,
    milliCol: -1,
    totalCol: -1,
    gramPriceCol: -1,
    itemCol: -1,
    personCol: -1,
    paymentCol: -1,
    dailyGoldPriceCol: -1,
    noteCol: -1,
  };

  headers.forEach((rawH, idx) => {
    const h = String(rawH || '').trim().toLowerCase();
    if (!h) return;

    if (
      mapping.dateCol === -1 &&
      (h.includes('تاريخ') || h.includes('يوم') || h.includes('date'))
    ) {
      mapping.dateCol = idx;
    } else if (
      mapping.kindCol === -1 &&
      (h.includes('نوع') || h.includes('حركة') || h.includes('type') || h.includes('kind'))
    ) {
      mapping.kindCol = idx;
    } else if (
      mapping.karatCol === -1 &&
      (h.includes('عيار') || h.includes('karat'))
    ) {
      mapping.karatCol = idx;
    } else if (
      mapping.milliCol === -1 &&
      (h === 'ملي' || h.includes('مليجرام') || h.includes('سهم') || h.includes('milli'))
    ) {
      mapping.milliCol = idx;
    } else if (
      mapping.weightCol === -1 &&
      (h.includes('وزن') || h.includes('جرام') || h.includes('weight') || h === 'ج')
    ) {
      mapping.weightCol = idx;
    } else if (
      mapping.dailyGoldPriceCol === -1 &&
      (h.includes('سعر الذهب') || h.includes('سعر اليوم') || h.includes('عيار 21 اليوم'))
    ) {
      mapping.dailyGoldPriceCol = idx;
    } else if (
      mapping.gramPriceCol === -1 &&
      (h.includes('سعر الجرام') || h.includes('سعر جرام') || h.includes('فئة'))
    ) {
      mapping.gramPriceCol = idx;
    } else if (
      mapping.totalCol === -1 &&
      (h.includes('اجمال') ||
        h.includes('إجمال') ||
        h.includes('مبلغ') ||
        h.includes('قيمة') ||
        h.includes('سعر') ||
        h.includes('total') ||
        h.includes('amount'))
    ) {
      mapping.totalCol = idx;
    } else if (
      mapping.itemCol === -1 &&
      (h.includes('بيان') || h.includes('صنف') || h.includes('تفاصيل') || h.includes('item'))
    ) {
      mapping.itemCol = idx;
    } else if (
      mapping.personCol === -1 &&
      (h.includes('شخص') || h.includes('عميل') || h.includes('مورد') || h.includes('اسم'))
    ) {
      mapping.personCol = idx;
    } else if (
      mapping.paymentCol === -1 &&
      (h.includes('دفع') || h.includes('نقدي') || h.includes('آجل') || h.includes('payment'))
    ) {
      mapping.paymentCol = idx;
    } else if (
      mapping.noteCol === -1 &&
      (h.includes('ملاحظ') || h.includes('note'))
    ) {
      mapping.noteCol = idx;
    }
  });

  // Fallback heuristics if headers were generic ("عمود 1", "عمود 2", ...)
  if (mapping.weightCol === -1 && mapping.totalCol === -1 && sampleRows.length > 0) {
    if (headers.length >= 2) {
      mapping.weightCol = 0;
      mapping.totalCol = 1;
      if (headers.length >= 3) mapping.itemCol = 2;
    }
  }

  return mapping;
}
