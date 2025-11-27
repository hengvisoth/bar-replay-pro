import type { Candle, IndicatorDefinition, IndicatorPoint } from "../data/types";

export interface IndicatorStrategy {
  readonly id: string;
  readonly definition: IndicatorDefinition;
  calculate(history: Candle[]): IndicatorPoint[];
  update(candle: Candle): IndicatorPoint | null;
  getSeries(): IndicatorPoint[];
  reset(): void;
}

export type IndicatorFactoryFn = (definition: IndicatorDefinition) => IndicatorStrategy;
