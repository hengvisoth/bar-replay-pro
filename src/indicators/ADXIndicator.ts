import type { Candle, IndicatorPoint } from "../data/types";
import { BaseIndicator } from "./BaseIndicator";

interface SmoothedValues {
  tr: number;
  pos: number;
  neg: number;
}

export class ADXIndicator extends BaseIndicator {
  private rawTR: number[] = [];
  private rawPosDM: number[] = [];
  private rawNegDM: number[] = [];
  private smoothedTR: number[] = [];
  private smoothedPosDM: number[] = [];
  private smoothedNegDM: number[] = [];
  private dxHistory: number[] = [];
  private prevADX: number | null = null;

  private get period() {
    return this.config.period ?? 14;
  }

  reset(): void {
    super.reset();
    this.clearState();
  }

  protected onCalculate(history: Candle[]): IndicatorPoint[] {
    this.clearState();

    const period = this.period;
    if (history.length === 0 || period <= 0) {
      return [];
    }

    const result: IndicatorPoint[] = [];
    let prevSmoothedTR = 0;
    let prevSmoothedPosDM = 0;
    let prevSmoothedNegDM = 0;

    for (let i = 0; i < history.length; i++) {
      const current = history[i];
      if (!current) {
        continue;
      }
      const prev = i > 0 ? history[i - 1] : undefined;
      const tr = this.computeTrueRange(current, prev);
      const { posDM, negDM } = this.computeDirectionalMovement(current, prev);

      this.rawTR.push(tr);
      this.rawPosDM.push(posDM);
      this.rawNegDM.push(negDM);

      if (i < period - 1) {
        this.smoothedTR.push(0);
        this.smoothedPosDM.push(0);
        this.smoothedNegDM.push(0);
        continue;
      }

      if (i === period - 1) {
        prevSmoothedTR = this.sumLast(this.rawTR, period);
        prevSmoothedPosDM = this.sumLast(this.rawPosDM, period);
        prevSmoothedNegDM = this.sumLast(this.rawNegDM, period);
      } else {
        prevSmoothedTR = this.rma(prevSmoothedTR, tr, period);
        prevSmoothedPosDM = this.rma(prevSmoothedPosDM, posDM, period);
        prevSmoothedNegDM = this.rma(prevSmoothedNegDM, negDM, period);
      }

      this.smoothedTR.push(prevSmoothedTR);
      this.smoothedPosDM.push(prevSmoothedPosDM);
      this.smoothedNegDM.push(prevSmoothedNegDM);

      const dx = this.computeDx(prevSmoothedTR, prevSmoothedPosDM, prevSmoothedNegDM);
      this.dxHistory.push(dx);

      if (this.dxHistory.length < period) {
        continue;
      }

      let value: number;
      const initial = this.averageRecentDx(period);
      if (this.prevADX == null) {
        if (initial == null) {
          continue;
        }
        value = initial;
      } else {
        value = this.rma(this.prevADX, dx, period);
      }

      this.prevADX = value;
      result.push({
        time: current.time,
        value,
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

    const index = len - 1;
    const prevCandle = len > 1 ? this.history[len - 2] : undefined;
    const tr = this.computeTrueRange(candle, prevCandle);
    const { posDM, negDM } = this.computeDirectionalMovement(candle, prevCandle);

    const replaceEntry = this.rawTR.length === len;
    this.upsertArray(this.rawTR, tr, replaceEntry);
    this.upsertArray(this.rawPosDM, posDM, replaceEntry);
    this.upsertArray(this.rawNegDM, negDM, replaceEntry);

    if (index < period - 1) {
      this.upsertArray(this.smoothedTR, 0, replaceEntry);
      this.upsertArray(this.smoothedPosDM, 0, replaceEntry);
      this.upsertArray(this.smoothedNegDM, 0, replaceEntry);
      return null;
    }

    const smoothed = this.computeSmoothedValues(
      tr,
      posDM,
      negDM,
      index,
      replaceEntry
    );
    if (!smoothed) {
      return null;
    }

    const dx = this.computeDx(smoothed.tr, smoothed.pos, smoothed.neg);
    this.upsertDx(dx, replaceEntry);

    if (this.dxHistory.length < period) {
      return null;
    }

    const lastPoint = this.data[this.data.length - 1];
    const isSameCandle = lastPoint && lastPoint.time === candle.time;

    const initial = this.averageRecentDx(period);
    let value: number;
    if (this.prevADX == null) {
      if (initial == null) {
        return null;
      }
      value = initial;
    } else {
      const prevIndex = isSameCandle ? this.data.length - 2 : this.data.length - 1;
      const prevEntry = prevIndex >= 0 ? this.data[prevIndex] : undefined;
      const anchor = prevEntry ? prevEntry.value : this.prevADX;
      if (anchor == null) {
        return null;
      }
      value = this.rma(anchor, dx, period);
    }

    if (!isSameCandle) {
      this.prevADX = value;
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

  private computeDirectionalMovement(current: Candle, prev?: Candle) {
    if (!prev) {
      return { posDM: 0, negDM: 0 };
    }
    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;
    const posDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const negDM = downMove > upMove && downMove > 0 ? downMove : 0;
    return { posDM, negDM };
  }

  private rma(prev: number, value: number, period: number) {
    return ((prev * (period - 1)) + value) / period;
  }

  private sumLast(values: number[], count: number) {
    let sum = 0;
    const start = Math.max(values.length - count, 0);
    for (let i = start; i < values.length; i++) {
      const value = values[i];
      if (value != null) {
        sum += value;
      }
    }
    return sum;
  }

  private computeDx(trSmooth: number, posSmooth: number, negSmooth: number) {
    if (trSmooth === 0) {
      return 0;
    }
    const posDI = (posSmooth / trSmooth) * 100;
    const negDI = (negSmooth / trSmooth) * 100;
    const denominator = posDI + negDI;
    if (denominator === 0) {
      return 0;
    }
    return (Math.abs(posDI - negDI) / denominator) * 100;
  }

  private computeSmoothedValues(
    tr: number,
    posDM: number,
    negDM: number,
    index: number,
    replaceEntry: boolean
  ): SmoothedValues | null {
    const period = this.period;
    let trSmooth: number;
    let posSmooth: number;
    let negSmooth: number;

    if (index === period - 1) {
      trSmooth = this.sumLast(this.rawTR, period);
      posSmooth = this.sumLast(this.rawPosDM, period);
      negSmooth = this.sumLast(this.rawNegDM, period);
    } else {
      const prevIndex = index - 1;
      const prevTR = this.smoothedTR[prevIndex] ?? 0;
      const prevPos = this.smoothedPosDM[prevIndex] ?? 0;
      const prevNeg = this.smoothedNegDM[prevIndex] ?? 0;
      trSmooth = this.rma(prevTR, tr, period);
      posSmooth = this.rma(prevPos, posDM, period);
      negSmooth = this.rma(prevNeg, negDM, period);
    }

    this.upsertArray(this.smoothedTR, trSmooth, replaceEntry);
    this.upsertArray(this.smoothedPosDM, posSmooth, replaceEntry);
    this.upsertArray(this.smoothedNegDM, negSmooth, replaceEntry);

    return { tr: trSmooth, pos: posSmooth, neg: negSmooth };
  }

  private upsertDx(value: number, replaceEntry: boolean) {
    if (replaceEntry && this.dxHistory.length > 0) {
      this.dxHistory[this.dxHistory.length - 1] = value;
    } else {
      this.dxHistory.push(value);
    }
  }

  private upsertArray(target: number[], value: number, replaceEntry: boolean) {
    if (replaceEntry && target.length > 0) {
      target[target.length - 1] = value;
    } else {
      target.push(value);
    }
  }

  private averageRecentDx(period: number): number | null {
    if (this.dxHistory.length < period) {
      return null;
    }
    const start = this.dxHistory.length - period;
    let sum = 0;
    for (let i = start; i < this.dxHistory.length; i++) {
      const value = this.dxHistory[i];
      if (value != null) {
        sum += value;
      }
    }
    return sum / period;
  }

  private clearState() {
    this.rawTR = [];
    this.rawPosDM = [];
    this.rawNegDM = [];
    this.smoothedTR = [];
    this.smoothedPosDM = [];
    this.smoothedNegDM = [];
    this.dxHistory = [];
    this.prevADX = null;
  }
}
