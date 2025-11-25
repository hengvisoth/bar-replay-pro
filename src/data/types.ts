// src/data/types.ts

import type { CandlestickData, UTCTimestamp } from "lightweight-charts";

export interface Candle extends CandlestickData<UTCTimestamp> {
  volume?: number;
}

// We use this type to identify which timeframe we are loading
export type Timeframe = "1m" | "15m" | "1h" | "4h" | "1d";
