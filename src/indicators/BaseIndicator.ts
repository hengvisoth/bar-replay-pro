import type { Candle, IndicatorDefinition, IndicatorPoint } from "../data/types";
import type { IndicatorStrategy } from "./types";

export abstract class BaseIndicator implements IndicatorStrategy {
  protected data: IndicatorPoint[] = [];
  protected history: Candle[] = [];

  constructor(protected readonly config: IndicatorDefinition) {}

  get id() {
    return this.config.id;
  }

  get definition() {
    return this.config;
  }

  calculate(history: Candle[]): IndicatorPoint[] {
    this.history = history.slice();
    this.data = this.onCalculate(this.history);
    return this.getSeries();
  }

  update(candle: Candle): IndicatorPoint | null {
    this.history = [...this.history, candle];
    const point = this.onUpdate(candle);
    if (!point) {
      return null;
    }

    const lastPoint = this.data[this.data.length - 1];
    if (lastPoint && lastPoint.time === point.time) {
      this.data[this.data.length - 1] = point;
    } else {
      this.data.push(point);
    }

    return point;
  }

  reset() {
    this.history = [];
    this.data = [];
  }

  getSeries(): IndicatorPoint[] {
    return this.data.slice();
  }

  protected getSourceValue(candle: Candle) {
    const source = this.config.source ?? "close";
    return candle[source] ?? candle.close;
  }

  protected abstract onCalculate(history: Candle[]): IndicatorPoint[];

  protected abstract onUpdate(candle: Candle): IndicatorPoint | null;
}
