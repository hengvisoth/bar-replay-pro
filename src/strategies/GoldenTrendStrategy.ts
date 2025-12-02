import type { Candle, IndicatorPoint } from "../data/types";
import { isBullishEngulfing, isHammer } from "../utils/patterns";

type IndicatorSeries = Record<string, IndicatorPoint[]>;

export type StrategyAction = "BUY" | "CLOSE_LONG" | "NONE";

export type PatternType = "BULLISH_ENGULFING" | "HAMMER";

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
    m15Indicators: IndicatorSeries
  ): StrategySignal {
    if (!h1Data.length || m15Data.length < 2) {
      return { action: "NONE" };
    }

    const h1Latest = h1Data[h1Data.length - 1]!;
    if (!this.hasBullishBias(h1Latest, h1Indicators)) {
      return { action: "NONE" };
    }

    const m15Latest = m15Data[m15Data.length - 1]!;
    if (this.shouldExitLong(m15Latest, m15Indicators)) {
      return { action: "CLOSE_LONG" };
    }

    const entrySignal = this.shouldEnterLong(m15Data, m15Indicators);
    if (entrySignal) {
      return {
        action: "BUY",
        stopLoss: entrySignal.stopLoss,
        pattern: entrySignal.pattern,
      };
    }

    return { action: "NONE" };
  }

  private hasBullishBias(candle: Candle, indicators: IndicatorSeries) {
    const ema50 = this.getLatestIndicatorValue(indicators, "ema50");
    const ema200 = this.getLatestIndicatorValue(indicators, "ema200");
    const adx14 = this.getLatestIndicatorValue(indicators, "adx14");

    if (ema50 == null || ema200 == null || adx14 == null) return false;

    return (candle.close ?? 0) > ema50 && ema50 > ema200 && adx14 > 25;
  }

  private shouldEnterLong(
    m15Data: Candle[],
    indicators: IndicatorSeries
  ): { stopLoss: number; pattern: PatternType } | null {
    const latest = m15Data[m15Data.length - 1]!;
    const previous = m15Data[m15Data.length - 2]!;

    const ema50 = this.getLatestIndicatorValue(indicators, "ema50");
    const rsi14 = this.getLatestIndicatorValue(indicators, "rsi14");
    const atr14 = this.getLatestIndicatorValue(indicators, "atr14");

    if (ema50 == null || rsi14 == null || atr14 == null) return null;

    const pulledBackToEma = (latest.low ?? 0) <= ema50;
    const isEngulf = isBullishEngulfing(latest, previous);
    const isHammerPattern = isHammer(latest);
    const triggerPattern = isEngulf || isHammerPattern;
    const rsiReset = rsi14 < 50;

    if (!pulledBackToEma || !triggerPattern || !rsiReset) return null;

    const stopLoss = Math.max(0, (latest.low ?? 0) - 2 * atr14);

    return {
      stopLoss,
      pattern: isEngulf ? "BULLISH_ENGULFING" : "HAMMER",
    };
  }

  private shouldExitLong(latest: Candle, indicators: IndicatorSeries) {
    const ema50 = this.getLatestIndicatorValue(indicators, "ema50");
    if (ema50 == null) return false;

    return (latest.close ?? 0) < ema50;
  }

  private getLatestIndicatorValue(
    indicators: IndicatorSeries,
    id: string
  ): number | null {
    const series = indicators?.[id];
    if (!series || series.length === 0) return null;

    return series[series.length - 1]?.value ?? null;
  }
}
