import type { IndicatorDefinition } from "../data/types";
import { SMAIndicator } from "./SMAIndicator";
import type { IndicatorStrategy } from "./types";

export function createIndicatorInstance(
  definition: IndicatorDefinition
): IndicatorStrategy {
  switch (definition.type) {
    case "sma":
      return new SMAIndicator(definition);
    default:
      throw new Error(`Unsupported indicator type: ${definition.type}`);
  }
}
