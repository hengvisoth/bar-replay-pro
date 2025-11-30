import type { IndicatorPoint, Candle } from "../data/types";
import { calculateSMA } from "../utils/indicators";
import { BaseIndicator } from "./BaseIndicator";

export class SMAIndicator extends BaseIndicator {
  private get period() {
    return this.config.period ?? 14;
  }

  protected onCalculate(history: Candle[]): IndicatorPoint[] {
    if (history.length === 0) return [];
    return calculateSMA(history, this.period);
  }

  protected onUpdate(candle: Candle): IndicatorPoint | null {
    const len = this.history.length;
    if (len < this.period) return null;

    let sum = 0;
    // Sum only the most recent N candles instead of copying arrays
    for (let i = 0; i < this.period; i++) {
      const candle = this.history[len - 1 - i];
      if (!candle) {
        return null;
      }
      sum += this.getSourceValue(candle);
    }

    return {
      time: candle.time,
      value: sum / this.period,
    };
  }
}
