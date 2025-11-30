import type { IndicatorDefinition } from "../data/types";

export const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  { id: "sma14", label: "SMA 14", type: "sma", period: 14, color: "#f0b90b" },
  { id: "sma50", label: "SMA 50", type: "sma", period: 50, color: "#1abc9c" },
  { id: "ema21", label: "EMA 21", type: "ema", period: 21, color: "#f472b6" },
  { id: "atr14", label: "ATR 14", type: "atr", period: 14, color: "#fb923c", lineWidth: 2 },
  { id: "rsi14", label: "RSI 14", type: "rsi", period: 14, color: "#a78bfa", lineWidth: 2 },
  { id: "adx14", label: "ADX 14", type: "adx", period: 14, color: "#38bdf8", lineWidth: 2 },
];
