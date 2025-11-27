// src/data/types.ts

import type { CandlestickData, UTCTimestamp } from "lightweight-charts";

export interface Candle extends CandlestickData<UTCTimestamp> {
  volume?: number;
}

export interface IndicatorPoint {
  time: UTCTimestamp;
  value: number;
}

export type IndicatorType = "sma";
export type CandleSource = "open" | "high" | "low" | "close";

export interface IndicatorDefinition {
  id: string;
  label: string;
  type: IndicatorType;
  period?: number;
  color: string;
  lineWidth?: number;
  source?: CandleSource;
}

// We use this type to identify which timeframe we are loading
export type Timeframe = "1m" | "15m" | "1h" | "4h" | "1d";
