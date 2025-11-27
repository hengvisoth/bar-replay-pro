import type { IndicatorPoint, Candle } from "../data/types";
import { appendSMA, calculateSMA } from "../utils/indicators";
import { BaseIndicator } from "./BaseIndicator";

export class SMAIndicator extends BaseIndicator {
  private get period() {
    return this.config.period ?? 14;
  }

  protected onCalculate(history: Candle[]): IndicatorPoint[] {
    if (history.length === 0) return [];
    return calculateSMA(history, this.period);
  }

  protected onUpdate(_candle: Candle): IndicatorPoint | null {
    if (this.history.length === 0) return null;
    const period = this.period;
    const series = appendSMA(this.data, this.history, period);
    this.data = series;
    return this.data[this.data.length - 1] ?? null;
  }
}
