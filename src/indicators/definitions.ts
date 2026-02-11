import type { IndicatorDefinition } from "../data/types";
import { INDICATOR_IDS } from "./indicatorIds";

export const INDICATOR_DEFAULT_COLORS = {
  [INDICATOR_IDS.EMA_20]: "#AC1513",
  [INDICATOR_IDS.EMA_50]: "#a75209",
  [INDICATOR_IDS.EMA_95]: "#1dacae",
  [INDICATOR_IDS.EMA_200]: "#0000a6",
  [INDICATOR_IDS.ATR_14]: "#fb923c",
  [INDICATOR_IDS.RSI_14]: "#a78bfa",
  [INDICATOR_IDS.ADX_14]: "#38bdf8",
} as const;

export const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  {
    id: INDICATOR_IDS.EMA_20,
    label: "EMA 20",
    type: "ema",
    period: 20,
    color: INDICATOR_DEFAULT_COLORS[INDICATOR_IDS.EMA_20],
    overlay: true,
  },
  {
    id: INDICATOR_IDS.EMA_50,
    label: "EMA 50",
    type: "ema",
    period: 50,
    color: INDICATOR_DEFAULT_COLORS[INDICATOR_IDS.EMA_50],
    overlay: true,
  },
  {
    id: INDICATOR_IDS.EMA_200,
    label: "EMA 200",
    type: "ema",
    period: 200,
    color: INDICATOR_DEFAULT_COLORS[INDICATOR_IDS.EMA_200],
    overlay: true,
  },
  {
    id: INDICATOR_IDS.EMA_95,
    label: "EMA 95",
    type: "ema",
    period: 95,
    color: INDICATOR_DEFAULT_COLORS[INDICATOR_IDS.EMA_95],
    overlay: true,
  },
  {
    id: INDICATOR_IDS.ATR_14,
    label: "ATR 14",
    type: "atr",
    period: 14,
    color: INDICATOR_DEFAULT_COLORS[INDICATOR_IDS.ATR_14],
    lineWidth: 2,
    overlay: false,
  },
  {
    id: INDICATOR_IDS.RSI_14,
    label: "RSI 14",
    type: "rsi",
    period: 14,
    color: INDICATOR_DEFAULT_COLORS[INDICATOR_IDS.RSI_14],
    lineWidth: 2,
    overlay: false,
  },
  {
    id: INDICATOR_IDS.ADX_14,
    label: "ADX 14",
    type: "adx",
    period: 14,
    color: INDICATOR_DEFAULT_COLORS[INDICATOR_IDS.ADX_14],
    lineWidth: 2,
    overlay: false,
  },
];
