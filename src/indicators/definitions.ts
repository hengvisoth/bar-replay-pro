import type { IndicatorDefinition } from "../data/types";

export const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  {
    id: "sma14",
    label: "SMA 14",
    type: "sma",
    period: 14,
    color: "#f0b90b",
    defaultActive: false,
  },
  {
    id: "sma50",
    label: "SMA 50",
    type: "sma",
    period: 50,
    color: "#1abc9c",
    defaultActive: false,
  },
  { id: "ema20", label: "EMA 20", type: "ema", period: 20, color: "#f472b6" },
  { id: "ema50", label: "EMA 50", type: "ema", period: 50, color: "#ec4899" },
  { id: "ema200", label: "EMA 200", type: "ema", period: 200, color: "#d946ef" },
  { id: "ema95", label: "EMA 95", type: "ema", period: 95, color: "#0ea5e9" },
  { id: "atr14", label: "ATR 14", type: "atr", period: 14, color: "#fb923c", lineWidth: 2 },
  { id: "rsi14", label: "RSI 14", type: "rsi", period: 14, color: "#a78bfa", lineWidth: 2 },
  { id: "adx14", label: "ADX 14", type: "adx", period: 14, color: "#38bdf8", lineWidth: 2 },
];
