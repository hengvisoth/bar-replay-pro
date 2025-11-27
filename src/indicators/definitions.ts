import type { IndicatorDefinition } from "../data/types";

export const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  { id: "sma14", label: "SMA 14", type: "sma", period: 14, color: "#f0b90b" },
  { id: "sma50", label: "SMA 50", type: "sma", period: 50, color: "#1abc9c" },
];
