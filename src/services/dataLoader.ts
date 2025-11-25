// src/services/dataLoader.ts

import type { Candle } from "../data/types";

export async function loadCsvData(
  symbol: string,
  timeframe: string,
  year: string,
  filename: string
): Promise<Candle[]> {
  // 1. Construct URL (Files must be in /public/data/raw/...)
  const url = `/data/raw/${symbol}/${timeframe}/${year}/${filename}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);

    const text = await response.text();
    return parseBinanceCsv(text);
  } catch (error) {
    console.error("CSV Load Error:", error);
    return [];
  }
}

function parseBinanceCsv(csvText: string): Candle[] {
  const lines = csvText.trim().split("\n");
  const candles: Candle[] = [];

  // Start at i = 1 to skip the header row (open_time, open, high...)
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");

    // Ensure the row has enough data (at least 6 columns)
    if (row.length < 6) continue;

    // Parse values
    // Column 0 is open_time in MS -> Divide by 1000 for Seconds
    const time = Math.floor(parseFloat(row[0]) / 1000);
    const open = parseFloat(row[1]);
    const high = parseFloat(row[2]);
    const low = parseFloat(row[3]);
    const close = parseFloat(row[4]);
    const volume = parseFloat(row[5]);

    // Safety check: ensure valid numbers
    if (isNaN(time) || isNaN(open)) continue;

    candles.push({ time, open, high, low, close, volume });
  }

  return candles;
}
