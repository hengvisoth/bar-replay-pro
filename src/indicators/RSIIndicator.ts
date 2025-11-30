import type { Candle, IndicatorPoint } from "../data/types";
import { BaseIndicator } from "./BaseIndicator";

export class RSIIndicator extends BaseIndicator {
  private avgGains: number[] = [];
  private avgLosses: number[] = [];

  private get period() {
    return this.config.period ?? 14;
  }

  reset(): void {
    super.reset();
    this.avgGains = [];
    this.avgLosses = [];
  }

  protected onCalculate(history: Candle[]): IndicatorPoint[] {
    this.avgGains = [];
    this.avgLosses = [];

    const period = this.period;
    if (history.length < period + 1 || period <= 0) {
      return [];
    }

    const result: IndicatorPoint[] = [];
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
      const current = history[i];
      const prev = history[i - 1];
      if (!current || !prev) {
        continue;
      }
      const change = this.getSourceValue(current) - this.getSourceValue(prev);
      if (change >= 0) {
        avgGain += change;
      } else {
        avgLoss += -change;
      }
    }

    avgGain /= period;
    avgLoss /= period;

    const pivot = history[period];
    if (!pivot) {
      return result;
    }
    result.push({
      time: pivot.time,
      value: this.computeRsi(avgGain, avgLoss),
    });
    this.avgGains.push(avgGain);
    this.avgLosses.push(avgLoss);

    for (let i = period + 1; i < history.length; i++) {
      const current = history[i];
      const prev = history[i - 1];
      if (!current || !prev) {
        continue;
      }
      const change = this.getSourceValue(current) - this.getSourceValue(prev);
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;

      result.push({
        time: current.time,
        value: this.computeRsi(avgGain, avgLoss),
      });
      this.avgGains.push(avgGain);
      this.avgLosses.push(avgLoss);
    }

    return result;
  }

  protected onUpdate(candle: Candle): IndicatorPoint | null {
    const period = this.period;
    const len = this.history.length;
    if (len < period + 1 || period <= 0) {
      return null;
    }

    const prevCandle = this.history[len - 2];
    if (!prevCandle) {
      return null;
    }
    const change = this.getSourceValue(candle) - this.getSourceValue(prevCandle);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    const lastPoint = this.data[this.data.length - 1];
    const isSameCandle = lastPoint && lastPoint.time === candle.time;
    const prevIndex = isSameCandle ? this.avgGains.length - 2 : this.avgGains.length - 1;

    let avgGain: number;
    let avgLoss: number;

    if (prevIndex >= 0) {
      const prevGain = this.avgGains[prevIndex];
      const prevLoss = this.avgLosses[prevIndex];
      if (prevGain == null || prevLoss == null) {
        return null;
      }
      avgGain = ((prevGain * (period - 1)) + gain) / period;
      avgLoss = ((prevLoss * (period - 1)) + loss) / period;
    } else {
      const seed = this.computeSeedAverages();
      if (!seed) {
        return null;
      }
      avgGain = seed.avgGain;
      avgLoss = seed.avgLoss;
    }

    const value = this.computeRsi(avgGain, avgLoss);

    if (isSameCandle && this.avgGains.length > 0 && this.avgLosses.length > 0) {
      this.avgGains[this.avgGains.length - 1] = avgGain;
      this.avgLosses[this.avgLosses.length - 1] = avgLoss;
    } else {
      this.avgGains.push(avgGain);
      this.avgLosses.push(avgLoss);
    }

    return {
      time: candle.time,
      value,
    };
  }

  private computeSeedAverages():
    | { avgGain: number; avgLoss: number }
    | null {
    const period = this.period;
    if (this.history.length < period + 1) {
      return null;
    }

    let gainSum = 0;
    let lossSum = 0;
    const start = this.history.length - period;

    for (let i = start; i < this.history.length; i++) {
      const current = this.history[i];
      const prev = this.history[i - 1];
      if (!current || !prev) {
        continue;
      }
      const change = this.getSourceValue(current) - this.getSourceValue(prev);
      if (change >= 0) {
        gainSum += change;
      } else {
        lossSum += -change;
      }
    }

    return {
      avgGain: gainSum / period,
      avgLoss: lossSum / period,
    };
  }

  private computeRsi(avgGain: number, avgLoss: number) {
    if (avgLoss === 0) {
      if (avgGain === 0) {
        return 50;
      }
      return 100;
    }

    if (avgGain === 0) {
      return 0;
    }

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }
}
