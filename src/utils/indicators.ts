import type { Candle, IndicatorPoint } from "../data/types";

export function calculateSMA(
  candles: Candle[],
  period: number
): IndicatorPoint[] {
  if (period <= 0 || candles.length < period) return [];

  const result: IndicatorPoint[] = [];
  let rollingSum = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) {
      continue;
    }
    rollingSum += candle.close;

    if (i >= period) {
      const prev = candles[i - period];
      if (prev) {
        rollingSum -= prev.close;
      }
    }

    if (i >= period - 1) {
      result.push({
        time: candle.time,
        value: rollingSum / period,
      });
    }
  }

  return result;
}

export function appendSMA(
  previousPoints: IndicatorPoint[] = [],
  candles: Candle[],
  period: number
): IndicatorPoint[] {
  if (period <= 0 || candles.length < period) {
    return candles.length < period ? [] : previousPoints.slice();
  }

  const latestCandle = candles[candles.length - 1];
  if (!latestCandle) return previousPoints.slice();

  let windowSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) {
      continue;
    }
    windowSum += candle.close;
  }

  const nextPoint: IndicatorPoint = {
    time: latestCandle.time,
    value: windowSum / period,
  };

  const cloned = previousPoints.slice();
  const lastPoint = cloned[cloned.length - 1];

  if (lastPoint && lastPoint.time === nextPoint.time) {
    cloned[cloned.length - 1] = nextPoint;
  } else {
    cloned.push(nextPoint);
  }

  return cloned;
}
