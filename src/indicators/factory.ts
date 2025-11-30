import type { IndicatorDefinition } from "../data/types";
import { SMAIndicator } from "./SMAIndicator";
import { EMAIndicator } from "./EMAIndicator";
import { ATRIndicator } from "./ATRIndicator";
import { RSIIndicator } from "./RSIIndicator";
import { ADXIndicator } from "./ADXIndicator";
import type { IndicatorStrategy } from "./types";

export function createIndicatorInstance(
  definition: IndicatorDefinition
): IndicatorStrategy {
  switch (definition.type) {
    case "sma":
      return new SMAIndicator(definition);
    case "ema":
      return new EMAIndicator(definition);
    case "atr":
      return new ATRIndicator(definition);
    case "rsi":
      return new RSIIndicator(definition);
    case "adx":
      return new ADXIndicator(definition);
    default:
      throw new Error(`Unsupported indicator type: ${definition.type}`);
  }
}
