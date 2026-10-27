import { AuditSettings, Issue, Operation } from '../../types';
import { formatNumber, formatWeight, normalizeItemCategory } from '../numerals';

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeMAD(values: number[], median: number): number {
  const absDevs = values.map((v) => Math.abs(v - median));
  return computeMedian(absDevs);
}

/**
 * Statistical outliers for gram price and weight using Median + MAD (robust z > threshold),
 * requiring at least 8 rows in the group, grouped by kind + karat + item so 18K and 21K are separated.
 */
export function checkStatisticalOutliers(
  operations: Operation[],
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const validOps = operations.filter(
    (op) => (op.kind === 'buy' || op.kind === 'sell') && op.weightG > 0 && op.total > 0
  );

  const itemGroups: Record<string, Operation[]> = {};
  const kindKaratGroups: Record<string, Operation[]> = {};

  for (const op of validOps) {
    const karat = op.karat || 21;
    const kkKey = `${op.kind}::${karat}`;
    if (!kindKaratGroups[kkKey]) kindKaratGroups[kkKey] = [];
    kindKaratGroups[kkKey].push(op);

    const cat = normalizeItemCategory(op.item);
    if (cat !== '__NO_ITEM__') {
      const key = `${op.kind}::${karat}::${cat}`;
      if (!itemGroups[key]) itemGroups[key] = [];
      itemGroups[key].push(op);
    }
  }

  const processedGramOutlierIds = new Set<string>();
  const processedWeightOutlierIds = new Set<string>();

  const analyzeGroup = (groupOps: Operation[], groupLabel: string) => {
    if (groupOps.length < 8) return;

    const gramPrices = groupOps.map((op) => op.total / op.weightG);
    const medPrice = computeMedian(gramPrices);
    const madPrice = computeMAD(gramPrices, medPrice);

    const weights = groupOps.map((op) => op.weightG);
    const medWeight = computeMedian(weights);
    const madWeight = computeMAD(weights, medWeight);

    for (const op of groupOps) {
      const gramPrice = op.total / op.weightG;
      if (madPrice > 0 && !processedGramOutlierIds.has(op.id)) {
        const robustZPrice = (0.6745 * Math.abs(gramPrice - medPrice)) / madPrice;
        if (robustZPrice > settings.robustZThreshold) {
          processedGramOutlierIds.add(op.id);
          issues.push({
            id: `outlier-price-${op.id}`,
            severity: robustZPrice > settings.robustZThreshold + 1.5 ? 'high' : 'medium',
            checkType: 'statistical_outlier',
            checkTitle: 'قيمة شاذة إحصائياً (Median+MAD)',
            rowId: op.id,
            date: op.date,
            kind: op.kind,
            message: `سعر الجرام (${formatNumber(gramPrice, 0)}) شاذ إحصائياً مقارنة بوسيط ${groupLabel} (${formatNumber(medPrice, 0)}) — معامل الشذوذ Z=${robustZPrice.toFixed(1)}.`,
            expected: `~${formatNumber(medPrice, 0)} ج.م/جرام`,
            actual: `${formatNumber(gramPrice, 0)} ج.م/جرام`,
            difference: `Z = ${robustZPrice.toFixed(1)}`,
          });
        }
      }

      if (madWeight > 0 && !processedWeightOutlierIds.has(op.id)) {
        const robustZWeight = (0.6745 * Math.abs(op.weightG - medWeight)) / madWeight;
        if (robustZWeight > settings.robustZThreshold + 0.5) {
          processedWeightOutlierIds.add(op.id);
          issues.push({
            id: `outlier-weight-${op.id}`,
            severity: 'medium',
            checkType: 'statistical_outlier',
            checkTitle: 'قيمة شاذة إحصائياً (Median+MAD)',
            rowId: op.id,
            date: op.date,
            kind: op.kind,
            message: `الوزن (${formatWeight(op.weightG)} جرام) شاذ إحصائياً مقارنة بوسيط أوزان ${groupLabel} (${formatWeight(medWeight)} جرام) — Z=${robustZWeight.toFixed(1)}.`,
            expected: `~${formatWeight(medWeight)} جرام`,
            actual: `${formatWeight(op.weightG)} جرام`,
            difference: `Z = ${robustZWeight.toFixed(1)}`,
          });
        }
      }
    }
  };

  for (const [, groupOps] of Object.entries(itemGroups)) {
    if (groupOps.length >= 8) {
      const sampleItem = groupOps[0].item || 'الصنف';
      const karat = groupOps[0].karat || 21;
      const kindAr = groupOps[0].kind === 'buy' ? 'مشتريات' : 'مبيعات';
      analyzeGroup(groupOps, `${kindAr} عيار ${karat} صنف "${sampleItem}"`);
    }
  }

  for (const [, groupOps] of Object.entries(kindKaratGroups)) {
    if (groupOps.length >= 8) {
      const karat = groupOps[0].karat || 21;
      const kindAr = groupOps[0].kind === 'buy' ? 'مشتريات' : 'مبيعات';
      analyzeGroup(groupOps, `${kindAr} عيار ${karat}`);
    }
  }

  return issues;
}
