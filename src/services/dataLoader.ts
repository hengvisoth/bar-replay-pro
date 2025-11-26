// src/services/dataLoader.ts

import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../data/types";

export type DataManifest = Record<string, Record<string, string[]>>;

export async function fetchManifest(): Promise<DataManifest> {
  try {
    const response = await fetch("/data-manifest.json", {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error("Failed to load data manifest");
    return (await response.json()) as DataManifest;
  } catch (error) {
    console.error("Manifest Load Error:", error);
    return {};
  }
}

export async function loadCsvData(filePath: string): Promise<Candle[]> {
  const url = filePath.startsWith("/") ? filePath : `/${filePath}`;

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
    const line = lines[i];
    if (!line) continue;

    const row = line.split(",");

    // Ensure the row has enough data (at least 6 columns)
    if (row.length < 6) continue;

    // Parse values
    // Column 0 is open_time in MS -> Divide by 1000 for Seconds
    const [openTime, openStr, highStr, lowStr, closeStr, volumeStr] = row as [
      string,
      string,
      string,
      string,
      string,
      string,
      ...string[]
    ];

    const time = Math.floor(parseFloat(openTime) / 1000) as UTCTimestamp;
    const open = parseFloat(openStr ?? "0");
    const high = parseFloat(highStr ?? "0");
    const low = parseFloat(lowStr ?? "0");
    const close = parseFloat(closeStr ?? "0");
    const volume = parseFloat(volumeStr ?? "0");

    // Safety check: ensure valid numbers
    if (isNaN(time) || isNaN(open)) continue;

    candles.push({ time, open, high, low, close, volume });
  }

  return candles;
}
