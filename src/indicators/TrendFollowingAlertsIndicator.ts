import type { SeriesMarker, UTCTimestamp } from "lightweight-charts";
import type { Candle, IndicatorPoint } from "../data/types";
import { BaseIndicator } from "./BaseIndicator";

export interface TrendFollowingAlertOptions {
  minBarsBetweenAlerts?: number;
  useStrictStack?: boolean;
  pullbackTouchEMA?: "EMA20" | "EMA50" | "EMA100";
  breakoutLookback?: number;
  atrLen?: number;
  maxCandleATR?: number;
  useVolumeFilter?: boolean;
  longColor?: string;
  shortColor?: string;
}

const DEFAULT_OPTIONS: Required<TrendFollowingAlertOptions> = {
  minBarsBetweenAlerts: 8,
  useStrictStack: true,
  pullbackTouchEMA: "EMA50",
  breakoutLookback: 30,
  atrLen: 14,
  maxCandleATR: 1.2,
  useVolumeFilter: false,
  longColor: "#22c55e",
  shortColor: "#ef4444",
};

export class TrendFollowingAlertsIndicator extends BaseIndicator {
  protected onCalculate(_history: Candle[]): IndicatorPoint[] {
    return [];
  }

  protected onUpdate(_candle: Candle): IndicatorPoint | null {
    return null;
  }
}

export function computeTrendFollowingAlertMarkers(
  lowTimeframeCandles: Candle[],
  htfCandles: Candle[],
  options: TrendFollowingAlertOptions = {},
): Array<SeriesMarker<UTCTimestamp>> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (lowTimeframeCandles.length < 3 || htfCandles.length < 3) {
    return [];
  }

  const close = lowTimeframeCandles.map((c) => c.close);
  const high = lowTimeframeCandles.map((c) => c.high);
  const low = lowTimeframeCandles.map((c) => c.low);
  const volume = lowTimeframeCandles.map((c) => c.volume ?? 0);

  const ema20 = computeEma(close, 20);
  const ema50 = computeEma(close, 50);
  const ema100 = computeEma(close, 100);
  const atr = computeAtr(lowTimeframeCandles, config.atrLen);
  const volumeSma20 = computeSma(volume, 20);

  const htfClose = htfCandles.map((c) => c.close);
  const htfE20 = computeEma(htfClose, 20);
  const htfE50 = computeEma(htfClose, 50);
  const htfE100 = computeEma(htfClose, 100);
  const htfE200 = computeEma(htfClose, 200);

  const markers: Array<SeriesMarker<UTCTimestamp>> = [];
  let lastPullBar: number | null = null;
  let lastBreakBar: number | null = null;
  let htfIndex = 0;

  for (let i = 1; i < lowTimeframeCandles.length; i += 1) {
    const candle = lowTimeframeCandles[i];
    if (!candle) continue;

    while (
      htfIndex + 1 < htfCandles.length &&
      (htfCandles[htfIndex + 1]?.time ?? 0) <= candle.time
    ) {
      htfIndex += 1;
    }
    const htfCandle = htfCandles[htfIndex];
    if (!htfCandle || htfCandle.time > candle.time) {
      continue;
    }

    const hClose = htfClose[htfIndex];
    const h20 = htfE20[htfIndex];
    const h50 = htfE50[htfIndex];
    const h100 = htfE100[htfIndex];
    const h200 = htfE200[htfIndex];
    if (
      hClose == null ||
      h20 == null ||
      h50 == null ||
      h100 == null ||
      h200 == null
    ) {
      continue;
    }

    const bullLoose = hClose > h200 && h20 > h50;
    const bearLoose = hClose < h200 && h20 < h50;
    const bullStrict = bullLoose && h20 > h50 && h50 > h100 && h100 > h200;
    const bearStrict = bearLoose && h20 < h50 && h50 < h100 && h100 < h200;
    const bullTrend = config.useStrictStack ? bullStrict : bullLoose;
    const bearTrend = config.useStrictStack ? bearStrict : bearLoose;

    const atrValue = atr[i];
    if (atrValue == null || atrValue <= 0) {
      continue;
    }
    const highValue = high[i];
    const lowValue = low[i];
    const closeValue = close[i];
    const volumeValue = volume[i];
    if (
      highValue == null ||
      lowValue == null ||
      closeValue == null ||
      volumeValue == null
    ) {
      continue;
    }
    const candleRange = highValue - lowValue;
    const okCandleSize = candleRange <= config.maxCandleATR * atrValue;
    const volumeAverage = volumeSma20[i];
    const volOk = config.useVolumeFilter
      ? volumeAverage != null && volumeValue > volumeAverage
      : true;

    const touchEma =
      config.pullbackTouchEMA === "EMA20"
        ? ema20[i]
        : config.pullbackTouchEMA === "EMA50"
          ? ema50[i]
          : ema100[i];
    const touchedPullback =
      touchEma != null && lowValue <= touchEma && closeValue > touchEma;
    const touchedPullbackShort =
      touchEma != null && highValue >= touchEma && closeValue < touchEma;

    const prevClose = close[i - 1];
    const prevEma20 = ema20[i - 1];
    const currEma20 = ema20[i];
    const crossUp20 =
      prevClose != null &&
      prevEma20 != null &&
      currEma20 != null &&
      prevClose <= prevEma20 &&
      closeValue > currEma20;
    const crossDown20 =
      prevClose != null &&
      prevEma20 != null &&
      currEma20 != null &&
      prevClose >= prevEma20 &&
      closeValue < currEma20;

    const reclaimLong =
      bullTrend && crossUp20 && touchedPullback && okCandleSize && volOk;
    const reclaimShort =
      bearTrend &&
      crossDown20 &&
      touchedPullbackShort &&
      okCandleSize &&
      volOk;

    const prevHigh = highest(high, i - 1, config.breakoutLookback);
    const prevLow = lowest(low, i - 1, config.breakoutLookback);
    const breakoutLong =
      prevHigh != null &&
      bullTrend &&
      closeValue > prevHigh &&
      okCandleSize &&
      volOk;
    const breakoutShort =
      prevLow != null &&
      bearTrend &&
      closeValue < prevLow &&
      okCandleSize &&
      volOk;

    const canPull =
      lastPullBar == null || i - lastPullBar >= config.minBarsBetweenAlerts;
    const canBreak =
      lastBreakBar == null || i - lastBreakBar >= config.minBarsBetweenAlerts;

    const pullLong = reclaimLong && canPull;
    const pullShort = reclaimShort && canPull;
    const brkLong = breakoutLong && canBreak;
    const brkShort = breakoutShort && canBreak;

    if (pullLong || pullShort) {
      lastPullBar = i;
    }
    if (brkLong || brkShort) {
      lastBreakBar = i;
    }

    if (pullLong) {
      markers.push({
        time: candle.time as UTCTimestamp,
        position: "belowBar",
        shape: "arrowUp",
        color: config.longColor,
        text: "PB▲",
      });
    }
    if (pullShort) {
      markers.push({
        time: candle.time as UTCTimestamp,
        position: "aboveBar",
        shape: "arrowDown",
        color: config.shortColor,
        text: "PB▼",
      });
    }
    if (brkLong) {
      markers.push({
        time: candle.time as UTCTimestamp,
        position: "belowBar",
        shape: "circle",
        color: config.longColor,
        text: "BO",
      });
    }
    if (brkShort) {
      markers.push({
        time: candle.time as UTCTimestamp,
        position: "aboveBar",
        shape: "circle",
        color: config.shortColor,
        text: "BO",
      });
    }
  }

  return markers;
}

function computeEma(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = [];
  if (values.length === 0 || period <= 0) {
    return result;
  }

  const factor = 2 / (period + 1);
  let previous: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null || Number.isNaN(value)) {
      result.push(previous);
      continue;
    }
    if (previous == null) {
      previous = value;
    } else {
      previous = value * factor + previous * (1 - factor);
    }
    result.push(previous);
  }
  return result;
}

function computeSma(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = [];
  if (values.length === 0 || period <= 0) {
    return result;
  }
  let rollingSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    rollingSum += values[i] ?? 0;
    if (i >= period) {
      rollingSum -= values[i - period] ?? 0;
    }
    result.push(i >= period - 1 ? rollingSum / period : null);
  }
  return result;
}

function computeAtr(candles: Candle[], period: number): Array<number | null> {
  const trValues = candles.map((current, i) => {
    const prev = i > 0 ? candles[i - 1] : undefined;
    const highLow = current.high - current.low;
    const highPrevClose = prev ? Math.abs(current.high - prev.close) : highLow;
    const lowPrevClose = prev ? Math.abs(current.low - prev.close) : highLow;
    return Math.max(highLow, highPrevClose, lowPrevClose);
  });

  const result: Array<number | null> = Array.from(
    { length: candles.length },
    () => null,
  );

  if (period <= 0 || trValues.length < period) {
    return result;
  }

  let sum = 0;
  for (let i = 0; i < trValues.length; i += 1) {
    const tr = trValues[i] ?? 0;
    if (i < period) {
      sum += tr;
      if (i === period - 1) {
        result[i] = sum / period;
      }
      continue;
    }
    const prevAtr = result[i - 1];
    if (prevAtr == null) {
      continue;
    }
    result[i] = ((prevAtr * (period - 1)) + tr) / period;
  }

  return result;
}

function highest(
  values: number[],
  endIndex: number,
  lookback: number,
): number | null {
  if (endIndex < 0 || lookback <= 0) return null;
  const start = Math.max(0, endIndex - lookback + 1);
  let max = Number.NEGATIVE_INFINITY;
  for (let i = start; i <= endIndex; i += 1) {
    const value = values[i];
    if (value != null && value > max) {
      max = value;
    }
  }
  return Number.isFinite(max) ? max : null;
}

function lowest(values: number[], endIndex: number, lookback: number): number | null {
  if (endIndex < 0 || lookback <= 0) return null;
  const start = Math.max(0, endIndex - lookback + 1);
  let min = Number.POSITIVE_INFINITY;
  for (let i = start; i <= endIndex; i += 1) {
    const value = values[i];
    if (value != null && value < min) {
      min = value;
    }
  }
  return Number.isFinite(min) ? min : null;
}
