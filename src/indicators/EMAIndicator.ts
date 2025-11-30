import type { Candle, IndicatorPoint } from "../data/types";
import { BaseIndicator } from "./BaseIndicator";

export class EMAIndicator extends BaseIndicator {
  private get period() {
    return this.config.period ?? 14;
  }

  private get smoothingFactor() {
    return 2 / (this.period + 1);
  }

  protected onCalculate(history: Candle[]): IndicatorPoint[] {
    if (history.length === 0) {
      return [];
    }

    const factor = this.smoothingFactor;
    const points: IndicatorPoint[] = [];
    const first = history[0];
    if (!first) {
      return points;
    }
    let previous = this.getSourceValue(first);

    points.push({
      time: first.time,
      value: previous,
    });

    for (let i = 1; i < history.length; i++) {
      const candle = history[i];
      if (!candle) {
        continue;
      }
      const price = this.getSourceValue(candle);
      const ema = price * factor + previous * (1 - factor);
      points.push({
        time: candle.time,
        value: ema,
      });
      previous = ema;
    }

    return points;
  }

  protected onUpdate(candle: Candle): IndicatorPoint | null {
    if (this.history.length === 0) {
      return null;
    }

    const factor = this.smoothingFactor;
    const price = this.getSourceValue(candle);
    const lastPoint = this.data[this.data.length - 1];
    const isSameCandle = lastPoint && lastPoint.time === candle.time;
    const prevIndex = isSameCandle ? this.data.length - 2 : this.data.length - 1;
    const prevPoint = prevIndex >= 0 ? this.data[prevIndex] : undefined;
    const prevValue = prevPoint ? prevPoint.value : price;

    const value = price * factor + prevValue * (1 - factor);

    return {
      time: candle.time,
      value,
    };
  }
}
