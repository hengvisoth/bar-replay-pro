#!/usr/bin/env node

import { readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(PUBLIC_DIR, "data", "raw");
const OUTPUT_FILE = path.join(PUBLIC_DIR, "data-manifest.json");

async function main() {
  if (!existsSync(DATA_DIR)) {
    throw new Error(`Data directory not found: ${DATA_DIR}`);
  }

  const manifest = await buildManifest();
  const json = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(OUTPUT_FILE, json, "utf8");
  console.log(`Data manifest written to ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
}

async function buildManifest() {
  const manifest = {};
  const symbolEntries = await safeReaddir(DATA_DIR);

  for (const entry of symbolEntries) {
    if (!entry.isDirectory()) continue;
    const symbol = entry.name;
    const symbolPath = path.join(DATA_DIR, symbol);
    const timeframeEntries = await safeReaddir(symbolPath);

    for (const timeframeEntry of timeframeEntries) {
      if (!timeframeEntry.isDirectory()) continue;
      const timeframe = timeframeEntry.name;
      const timeframePath = path.join(symbolPath, timeframe);
      const csvFiles = await collectCsvFiles(timeframePath);
      if (csvFiles.length === 0) continue;

      if (!manifest[symbol]) {
        manifest[symbol] = {};
      }
      manifest[symbol][timeframe] = csvFiles.sort();
    }
  }

  return manifest;
}

async function collectCsvFiles(dir) {
  const entries = await safeReaddir(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectCsvFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
      files.push(toPublicRelative(fullPath));
    }
  }

  return files;
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`Warning: unable to read directory ${dir}:`, error.message);
    return [];
  }
}

function toPublicRelative(filePath) {
  const relative = path.relative(PUBLIC_DIR, filePath);
  return relative.split(path.sep).join("/");
}

main().catch((error) => {
  console.error("Failed to generate data manifest:", error);
  process.exit(1);
});
