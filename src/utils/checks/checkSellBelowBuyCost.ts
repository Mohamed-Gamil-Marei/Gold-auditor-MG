import { Issue, Operation } from '../../types';
import { formatNumber } from '../numerals';

/**
 * Prompt 1 Check 4 + Prompt 5.5 Profit Margin Drop:
 * - Average sell price per gram < average buy price per gram for the same karat on the same day or nearest day (high).
 * - Profit margin drop > 30% compared to usual average margin across days for the same karat (medium).
 */
export function checkSellBelowBuyCost(operations: Operation[]): Issue[] {
  const issues: Issue[] = [];

  type DayStat = { buyWeight: number; buyTotal: number; sellWeight: number; sellTotal: number };
  const byKaratAndDate: Record<string, Record<string, DayStat>> = {};

  for (const op of operations) {
    if ((op.kind !== 'buy' && op.kind !== 'sell') || op.weightG <= 0 || op.total <= 0) continue;
    const karat = op.karat ?? 21;
    if (karat === 'other') continue; // 'other' has heterogeneous items (coins, bars, etc.)
    const kKey = String(karat);
    if (!byKaratAndDate[kKey]) byKaratAndDate[kKey] = {};
    if (!byKaratAndDate[kKey][op.date]) {
      byKaratAndDate[kKey][op.date] = { buyWeight: 0, buyTotal: 0, sellWeight: 0, sellTotal: 0 };
    }
    if (op.kind === 'buy') {
      byKaratAndDate[kKey][op.date].buyWeight += op.weightG;
      byKaratAndDate[kKey][op.date].buyTotal += op.total;
    } else {
      byKaratAndDate[kKey][op.date].sellWeight += op.weightG;
      byKaratAndDate[kKey][op.date].sellTotal += op.total;
    }
  }

  const toDayNum = (iso: string) => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);

  for (const kKey of Object.keys(byKaratAndDate).sort()) {
    const byDate = byKaratAndDate[kKey];
    const dates = Object.keys(byDate).sort();
    const dailyMargins: { date: string; margin: number }[] = [];

    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      const stat = byDate[d];
      if (stat.sellWeight <= 0) continue;

      const avgSell = stat.sellTotal / stat.sellWeight;
      let avgBuy = stat.buyWeight > 0 ? stat.buyTotal / stat.buyWeight : 0;
      let refBuyDate = d;

      // If no buy of the same karat on the same day, find nearest day with a buy of the same karat
      if (avgBuy === 0) {
        let bestDist = Infinity;
        const dNum = toDayNum(d);
        for (const otherDate of dates) {
          if (byDate[otherDate].buyWeight > 0) {
            const dist = Math.abs(dNum - toDayNum(otherDate));
            if (dist < bestDist) {
              bestDist = dist;
              avgBuy = byDate[otherDate].buyTotal / byDate[otherDate].buyWeight;
              refBuyDate = otherDate;
            }
          }
        }
      }

      if (avgBuy > 0) {
        const margin = avgSell - avgBuy;
        dailyMargins.push({ date: d, margin });

        if (avgSell < avgBuy) {
          const lossPerGram = avgBuy - avgSell;
          issues.push({
            id: `sell-below-buy-${d}-k${kKey}`,
            severity: 'high',
            checkType: 'sell_below_buy',
            checkTitle: 'بيع أقل من تكلفة الشراء',
            date: d,
            kind: 'sell',
            message: `عيار ${kKey}: متوسط سعر بيع الجرام (${formatNumber(avgSell, 0)}) أقل من متوسط تكلفة شراء الجرام (${formatNumber(avgBuy, 0)}${refBuyDate !== d ? ` ليوم ${refBuyDate}` : ''}) بخسارة ${formatNumber(lossPerGram, 0)} ج.م/جرام.`,
            expected: `>= ${formatNumber(avgBuy, 0)} ج.م`,
            actual: `${formatNumber(avgSell, 0)} ج.م`,
            difference: `-${formatNumber(lossPerGram, 0)} ج.م/جرام`,
          });
        }
      }
    }

    // Prompt 5.5: Check if positive profit margin dropped suddenly by > 30% compared to usual positive margin for this karat
    const positiveMargins = dailyMargins.filter((m) => m.margin > 0);
    if (positiveMargins.length >= 3) {
      const avgMargin =
        positiveMargins.reduce((acc, item) => acc + item.margin, 0) / positiveMargins.length;
      for (const item of positiveMargins) {
        if (avgMargin > 20 && item.margin < avgMargin * 0.7) {
          const dropPct = ((avgMargin - item.margin) / avgMargin) * 100;
          issues.push({
            id: `margin-drop-${item.date}-k${kKey}`,
            severity: 'medium',
            checkType: 'profit_margin_drop',
            checkTitle: 'انخفاض مفاجئ في هامش الربح',
            date: item.date,
            kind: 'sell',
            message: `عيار ${kKey}: هامش ربح الجرام اليومي (${formatNumber(item.margin, 0)} ج.م) انخفض بنسبة ${dropPct.toFixed(0)}% عن المعتاد (${formatNumber(avgMargin, 0)} ج.م/جرام).`,
            expected: `${formatNumber(avgMargin, 0)} ج.م/جرام`,
            actual: `${formatNumber(item.margin, 0)} ج.م/جرام`,
            difference: `-${dropPct.toFixed(0)}%`,
          });
        }
      }
    }
  }

  return issues;
}
