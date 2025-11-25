// src/data/types.ts

export interface Candle {
  time: number; // Unix Timestamp in SECONDS
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// We use this type to identify which timeframe we are loading
export type Timeframe = "1m" | "15m" | "1h" | "4h" | "1d";
