import type { Candle, IndicatorPoint } from "../data/types";
import { BaseIndicator } from "./BaseIndicator";

export class ATRIndicator extends BaseIndicator {
  private get period() {
    return this.config.period ?? 14;
  }

  protected onCalculate(history: Candle[]): IndicatorPoint[] {
    const period = this.period;
    if (history.length === 0 || period <= 0) {
      return [];
    }

    const result: IndicatorPoint[] = [];
    const trValues: number[] = [];

    for (let i = 0; i < history.length; i++) {
      const current = history[i];
      if (!current) {
        continue;
      }
      const prev = i > 0 ? history[i - 1] : undefined;
      const tr = this.computeTrueRange(current, prev);
      trValues.push(tr);

      if (trValues.length < period) {
        continue;
      }

      let atr: number;
      if (trValues.length === period) {
        const sum = trValues.reduce((acc, value) => acc + value, 0);
        atr = sum / period;
      } else {
        const prevPoint = result[result.length - 1];
        if (!prevPoint) {
          continue;
        }
        const prevAtr = prevPoint.value;
        atr = ((prevAtr * (period - 1)) + tr) / period;
      }

      result.push({
        time: current.time,
        value: atr,
      });
    }

    return result;
  }

  protected onUpdate(candle: Candle): IndicatorPoint | null {
    const period = this.period;
    const len = this.history.length;
    if (len === 0 || period <= 0) {
      return null;
    }

    if (len < period) {
      return null;
    }

    const prevCandle = len > 1 ? this.history[len - 2] : undefined;
    const tr = this.computeTrueRange(candle, prevCandle);
    const lastPoint = this.data[this.data.length - 1];
    const isSameCandle = lastPoint && lastPoint.time === candle.time;
    const prevIndex = isSameCandle ? this.data.length - 2 : this.data.length - 1;

    let value: number | null = null;

    if (prevIndex >= 0) {
      const prevEntry = this.data[prevIndex];
      if (prevEntry) {
        value = ((prevEntry.value * (period - 1)) + tr) / period;
      }
    } else {
      value = this.computeSeedAtr();
    }

    if (value == null) {
      return null;
    }

    return {
      time: candle.time,
      value,
    };
  }

  private computeTrueRange(current: Candle, prev?: Candle) {
    const highLow = current.high - current.low;
    const highPrevClose = prev ? Math.abs(current.high - prev.close) : highLow;
    const lowPrevClose = prev ? Math.abs(current.low - prev.close) : highLow;
    return Math.max(highLow, highPrevClose, lowPrevClose);
  }

  private computeSeedAtr(): number | null {
    const period = this.period;
    if (this.history.length < period) {
      return null;
    }

    let sum = 0;
    const start = this.history.length - period;
    for (let i = start; i < this.history.length; i++) {
      const current = this.history[i];
      if (!current) {
        continue;
      }
      const prev = i > 0 ? this.history[i - 1] : undefined;
      sum += this.computeTrueRange(current, prev);
    }

    return sum / period;
  }
}
