import type { Candle, IndicatorPoint } from "../data/types";
import {
  isBearishEngulfing,
  isBullishEngulfing,
  isHammer,
  isShootingStar,
} from "../utils/patterns";

type IndicatorSeries = Record<string, IndicatorPoint[]>;

type PositionSide = "long" | "short";

type PositionSnapshot = { side: PositionSide; entryPrice: number };

export type StrategyAction =
  | "BUY"
  | "SELL"
  | "CLOSE_LONG"
  | "CLOSE_SHORT"
  | "NONE";

export type PatternType =
  | "BULLISH_ENGULFING"
  | "HAMMER"
  | "BEARISH_ENGULFING"
  | "SHOOTING_STAR";

export interface StrategySignal {
  action: StrategyAction;
  stopLoss?: number | null;
  pattern?: PatternType | null;
}

export class GoldenTrendStrategy {
  checkSignals(
    h1Data: Candle[],
    m15Data: Candle[],
    h1Indicators: IndicatorSeries,
    m15Indicators: IndicatorSeries,
    openPositions: PositionSnapshot[] = []
  ): StrategySignal {
    if (!h1Data.length || m15Data.length < 2) {
      return { action: "NONE" };
    }

    const h1Latest = h1Data[h1Data.length - 1]!;
    const m15Latest = m15Data[m15Data.length - 1]!;

    if (this.shouldExitLong(m15Latest, m15Indicators, openPositions)) {
      return { action: "CLOSE_LONG" };
    }

    if (this.shouldExitShort(m15Latest, m15Indicators, openPositions)) {
      return { action: "CLOSE_SHORT" };
    }

    const longBias = this.hasBullishBias(h1Latest, h1Indicators);
    const shortBias = this.hasBearishBias(h1Latest, h1Indicators);

    if (longBias) {
      const entrySignal = this.shouldEnterLong(m15Data, m15Indicators);
      if (entrySignal) {
        return {
          action: "BUY",
          stopLoss: entrySignal.stopLoss,
          pattern: entrySignal.pattern,
        };
      }
    }

    if (shortBias) {
      const entrySignal = this.shouldEnterShort(m15Data, m15Indicators);
      if (entrySignal) {
        return {
          action: "SELL",
          stopLoss: entrySignal.stopLoss,
          pattern: entrySignal.pattern,
        };
      }
    }

    return { action: "NONE" };
  }

  private hasBullishBias(candle: Candle, indicators: IndicatorSeries) {
    const ema50 = this.getIndicatorValue(indicators, "ema50");
    const ema200 = this.getIndicatorValue(indicators, "ema200");
    const adx14 = this.getIndicatorValue(indicators, "adx14");

    if (ema50 == null || ema200 == null || adx14 == null) return false;

    const previousEma50 = this.getIndicatorValue(indicators, "ema50", 1);
    const previousEma200 = this.getIndicatorValue(indicators, "ema200", 1);
    const previousGap =
      previousEma50 != null && previousEma200 != null
        ? previousEma50 - previousEma200
        : null;
    const currentGap = ema50 - ema200;

    const gapHolding = previousGap == null || currentGap >= previousGap;

    return (candle.close ?? 0) > ema50 && ema50 > ema200 && adx14 > 25 && gapHolding;
  }

  private hasBearishBias(candle: Candle, indicators: IndicatorSeries) {
    const ema50 = this.getIndicatorValue(indicators, "ema50");
    const ema200 = this.getIndicatorValue(indicators, "ema200");
    const adx14 = this.getIndicatorValue(indicators, "adx14");

    if (ema50 == null || ema200 == null || adx14 == null) return false;

    const previousEma50 = this.getIndicatorValue(indicators, "ema50", 1);
    const previousEma200 = this.getIndicatorValue(indicators, "ema200", 1);
    const previousGap =
      previousEma50 != null && previousEma200 != null
        ? previousEma50 - previousEma200
        : null;
    const currentGap = ema50 - ema200;

    const gapHolding = previousGap == null || currentGap <= previousGap;

    return (candle.close ?? 0) < ema50 && ema50 < ema200 && adx14 > 25 && gapHolding;
  }

  private shouldEnterLong(
    m15Data: Candle[],
    indicators: IndicatorSeries
  ): { stopLoss: number; pattern: PatternType } | null {
    const latest = m15Data[m15Data.length - 1]!;
    const previous = m15Data[m15Data.length - 2]!;

    const ema20 = this.getIndicatorValue(indicators, "ema20");
    const ema50 = this.getIndicatorValue(indicators, "ema50");
    const rsi14 = this.getIndicatorValue(indicators, "rsi14");
    const atr14 = this.getIndicatorValue(indicators, "atr14");

    if (ema20 == null || ema50 == null || rsi14 == null || atr14 == null) return null;

    const pulledBackToValueZone =
      (latest.low ?? 0) <= ema50 && (latest.close ?? 0) >= ema20;
    const isEngulf = isBullishEngulfing(latest, previous);
    const isHammerPattern = isHammer(latest);
    const triggerPattern = isEngulf || isHammerPattern;
    const rsiReset = rsi14 < 45;

    if (!pulledBackToValueZone || !triggerPattern || !rsiReset) return null;

    const stopLoss = Math.max(0, (latest.low ?? 0) - 2 * atr14);

    return {
      stopLoss,
      pattern: isEngulf ? "BULLISH_ENGULFING" : "HAMMER",
    };
  }

  private shouldEnterShort(
    m15Data: Candle[],
    indicators: IndicatorSeries
  ): { stopLoss: number; pattern: PatternType } | null {
    const latest = m15Data[m15Data.length - 1]!;
    const previous = m15Data[m15Data.length - 2]!;

    const ema20 = this.getIndicatorValue(indicators, "ema20");
    const ema50 = this.getIndicatorValue(indicators, "ema50");
    const rsi14 = this.getIndicatorValue(indicators, "rsi14");
    const atr14 = this.getIndicatorValue(indicators, "atr14");

    if (ema20 == null || ema50 == null || rsi14 == null || atr14 == null) return null;

    const pulledBackToValueZone =
      (latest.high ?? 0) >= ema50 && (latest.close ?? 0) <= ema20;
    const isEngulf = isBearishEngulfing(latest, previous);
    const isShootingStarPattern = isShootingStar(latest);
    const triggerPattern = isEngulf || isShootingStarPattern;
    const rsiReset = rsi14 > 55;

    if (!pulledBackToValueZone || !triggerPattern || !rsiReset) return null;

    const stopLoss = Math.max(0, (latest.high ?? 0) + 2 * atr14);

    return {
      stopLoss,
      pattern: isEngulf ? "BEARISH_ENGULFING" : "SHOOTING_STAR",
    };
  }

  private shouldExitLong(
    latest: Candle,
    indicators: IndicatorSeries,
    openPositions: PositionSnapshot[]
  ) {
    const ema95 = this.getIndicatorValue(indicators, "ema95");
    if (ema95 == null) return false;

    const hasProfitableLong = openPositions.some(
      (pos) => pos.side === "long" && (latest.close ?? 0) > pos.entryPrice
    );

    const bearishMomentum = (latest.close ?? 0) < (latest.open ?? 0);

    return hasProfitableLong && (latest.close ?? 0) < ema95 && bearishMomentum;
  }

  private shouldExitShort(
    latest: Candle,
    indicators: IndicatorSeries,
    openPositions: PositionSnapshot[]
  ) {
    const ema95 = this.getIndicatorValue(indicators, "ema95");
    if (ema95 == null) return false;

    const hasProfitableShort = openPositions.some(
      (pos) => pos.side === "short" && (latest.close ?? 0) < pos.entryPrice
    );

    const bullishMomentum = (latest.close ?? 0) > (latest.open ?? 0);

    return hasProfitableShort && (latest.close ?? 0) > ema95 && bullishMomentum;
  }

  private getIndicatorValue(
    indicators: IndicatorSeries,
    id: string,
    offset = 0
  ): number | null {
    const series = indicators?.[id];
    if (!series || series.length === 0) return null;

    const targetIndex = series.length - 1 - offset;
    if (targetIndex < 0) return null;

    return series[targetIndex]?.value ?? null;
  }
}
