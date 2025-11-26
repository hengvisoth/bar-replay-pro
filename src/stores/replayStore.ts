import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { fetchManifest, loadCsvData } from "../services/dataLoader";
import type { DataManifest } from "../services/dataLoader";
import type {
  Candle,
  Timeframe,
  IndicatorPoint,
  IndicatorDefinition,
} from "../data/types";
import { calculateSMA, appendSMA } from "../utils/indicators";
import { useTradingStore } from "./tradingStore";

const AVAILABLE_TIMEFRAMES: Timeframe[] = ["15m", "1h"];
const TIMEFRAME_STEP_SECONDS: Record<string, number> = {
  "15m": 60 * 15,
  "1h": 60 * 60,
};
const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  { id: "sma14", label: "SMA 14", type: "sma", period: 14, color: "#f0b90b" },
  { id: "sma50", label: "SMA 50", type: "sma", period: 50, color: "#1abc9c" },
];

type IndicatorState = Record<string, boolean>;

const defaultIndicatorState: IndicatorState = INDICATOR_DEFINITIONS.reduce(
  (acc, indicator) => {
    acc[indicator.id] = true;
    return acc;
  },
  {} as IndicatorState
);

export const useReplayStore = defineStore("replay", () => {
  // --- STATE ---
  // We now map keys (e.g., "1h", "15m") to data arrays
  const tradingStore = useTradingStore();
  const datasets = ref<Record<string, Candle[]>>({});
  const visibleDatasets = ref<Record<string, Candle[]>>({});
  const visibleIndicators = ref<
    Record<string, Record<string, IndicatorPoint[]>>
  >({});
  const dataManifest = ref<DataManifest | null>(null);
  const activeSymbol = ref<string>("ETHUSDT");

  const isPlaying = ref(false);
  const isSelectingReplay = ref(false);
  const playbackSpeed = ref(1000);
  const activeTimeframe = ref<Timeframe>("1h");
  const activeIndicators = ref<IndicatorState>({ ...defaultIndicatorState });

  // The Master Clock (Unix Timestamp)
  const currentReplayTime = ref<number>(0);

  const activeDataset = computed(() => {
    return datasets.value[activeTimeframe.value] || [];
  });

  const minReplayTime = computed(() => {
    const firstCandle = activeDataset.value[0];
    return firstCandle ? firstCandle.time : 0;
  });

  const maxReplayTime = computed(() => {
    const lastCandle = activeDataset.value[activeDataset.value.length - 1];
    return lastCandle ? lastCandle.time : 0;
  });

  // Map current time to the active timeframe's index for slider alignment
  const masterIndex = computed(() => {
    const index = activeDataset.value.findIndex(
      (c) => c.time >= currentReplayTime.value
    );

    if (index === -1) {
      return activeDataset.value.length > 0
        ? activeDataset.value.length - 1
        : 0;
    }

    return index;
  });

  // --- ACTIONS ---

  async function loadData() {
    const manifest = await ensureManifest();
    if (!manifest) return;

    const symbolManifest = manifest[activeSymbol.value];
    if (!symbolManifest) {
      console.warn(`No manifest entries for symbol ${activeSymbol.value}`);
      return;
    }

    const loaded: Record<string, Candle[]> = {};

    await Promise.all(
      AVAILABLE_TIMEFRAMES.map(async (tf) => {
        const files = symbolManifest[tf] || [];
        if (files.length === 0) {
          loaded[tf] = [];
          return;
        }

        const results = await Promise.all(files.map((filePath) => loadCsvData(filePath)));
        const merged = results.flat().sort((a, b) => a.time - b.time);
        loaded[tf] = merged;
      })
    );

    datasets.value = loaded;

    const activeData = loaded[activeTimeframe.value] || [];
    const lastCandle = activeData[activeData.length - 1];
    if (lastCandle) {
      currentReplayTime.value = lastCandle.time;
      updateView();
    }
  }

  async function ensureManifest() {
    if (dataManifest.value) {
      return dataManifest.value;
    }
    const manifest = await fetchManifest();
    dataManifest.value = manifest;
    return manifest;
  }

  const availableSymbols = computed(() => Object.keys(dataManifest.value || {}));

  async function setSymbol(symbol: string) {
    if (symbol === activeSymbol.value) return;
    activeSymbol.value = symbol;
    datasets.value = {};
    visibleDatasets.value = {};
    visibleIndicators.value = {};
    tradingStore.resetSession();
    await loadData();
  }

  function nextTick() {
    const step = TIMEFRAME_STEP_SECONDS[activeTimeframe.value] || 3600;
    const nextTime = currentReplayTime.value + step;

    if (nextTime > maxReplayTime.value) {
      isPlaying.value = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      return;
    }

    currentReplayTime.value = nextTime;
    updateView();
  }

  function updateView() {
    // Filter ALL datasets based on the Master Clock
    const newVisible: Record<string, Candle[]> = {};
    const newIndicators: Record<string, Record<string, IndicatorPoint[]>> = {};

    for (const [key, data] of Object.entries(datasets.value)) {
      // Binary search would be faster here for large datasets,
      // but filter is fine for <10k items
      const cutoffIndex = findVisibleEndIndex(data, currentReplayTime.value);
      const filtered =
        cutoffIndex >= 0 ? data.slice(0, cutoffIndex + 1) : ([] as Candle[]);
      newVisible[key] = filtered;

      newIndicators[key] = computeIndicatorsForVisible(
        filtered,
        visibleDatasets.value[key] || [],
        visibleIndicators.value[key] || {},
        activeIndicators.value
      );
    }

    visibleDatasets.value = newVisible;
    visibleIndicators.value = newIndicators;
  }

  function jumpTo(index: number) {
    const active = datasets.value[activeTimeframe.value];
    if (!active || !active[index]) return;

    // Jump clock to the specific candle's time
    currentReplayTime.value = active[index].time;
    updateView();
  }

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function clampReplayTime() {
    const min = minReplayTime.value;
    const max = maxReplayTime.value;
    if (!min && !max) return;

    if (currentReplayTime.value < min) {
      currentReplayTime.value = min;
    } else if (currentReplayTime.value > max) {
      currentReplayTime.value = max;
    }
  }

  function setActiveTimeframe(tf: Timeframe) {
    if (activeTimeframe.value === tf) return;

    activeTimeframe.value = tf;
    clampReplayTime();
    updateView();
  }

  function toggleIndicator(id: string) {
    if (!(id in activeIndicators.value)) return;
    activeIndicators.value[id] = !activeIndicators.value[id];
    updateView();
  }

  function isIndicatorActive(id: string) {
    return !!activeIndicators.value[id];
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value;
    if (isPlaying.value) {
      intervalId = setInterval(nextTick, playbackSpeed.value);
    } else if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function toggleReplaySelection() {
    isSelectingReplay.value = !isSelectingReplay.value;
    if (isSelectingReplay.value && isPlaying.value) {
      isPlaying.value = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  }

  function setReplayStart(time: number | null | undefined) {
    if (time == null) return;
    currentReplayTime.value = time;
    clampReplayTime();
    updateView();
    isSelectingReplay.value = false;
  }

  function setPlaybackInterval(intervalMs: number) {
    playbackSpeed.value = intervalMs;
    if (isPlaying.value) {
      if (intervalId) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(nextTick, playbackSpeed.value);
    }
  }

  // Formatted Date for UI
  const currentDate = computed(() => {
    if (!currentReplayTime.value) return "";
    return new Date(currentReplayTime.value * 1000).toLocaleString();
  });

  // For the slider max value
  const totalCandles = computed(() => activeDataset.value.length || 0);

  const activeIndicatorDefinitions = computed(() =>
    INDICATOR_DEFINITIONS.filter((def) => activeIndicators.value[def.id])
  );

  return {
    availableTimeframes: AVAILABLE_TIMEFRAMES,
    indicatorDefinitions: INDICATOR_DEFINITIONS,
    activeIndicatorDefinitions,
    activeTimeframe,
    activeIndicators,
    datasets,
    activeSymbol,
    availableSymbols,
    visibleDatasets,
    visibleIndicators,
    isPlaying,
    isSelectingReplay,
    playbackSpeed,
    currentReplayTime,
    currentDate,
    totalCandles,
    masterIndex, // Expose index for slider position
    loadData,
    togglePlay,
    jumpTo,
    setSymbol,
    toggleReplaySelection,
    setReplayStart,
    setActiveTimeframe,
    toggleIndicator,
    isIndicatorActive,
    setPlaybackInterval,
  };
});

function computeIndicatorsForVisible(
  visibleCandles: Candle[],
  previousVisible: Candle[],
  previousIndicators: Record<string, IndicatorPoint[]>,
  activeIndicatorState: IndicatorState
): Record<string, IndicatorPoint[]> {
  const result: Record<string, IndicatorPoint[]> = {};

  const prevLength = previousVisible?.length ?? 0;
  const newLength = visibleCandles.length;
  const hasNewCandle = newLength > prevLength;
  const isReset = newLength < prevLength;
  const isJump = newLength - prevLength > 1;

  for (const definition of INDICATOR_DEFINITIONS) {
    if (!activeIndicatorState[definition.id]) {
      result[definition.id] = [];
      continue;
    }

    const period = definition.period ?? 0;
    if (period <= 0 || newLength < period) {
      result[definition.id] = [];
      continue;
    }

    const prevSeries = previousIndicators?.[definition.id] || [];

    if (definition.type === "sma") {
      if (isReset || isJump || prevSeries.length === 0) {
        result[definition.id] = calculateSMA(visibleCandles, period);
        continue;
      }

      if (!hasNewCandle) {
        result[definition.id] = prevSeries.slice();
        continue;
      }

      result[definition.id] = appendSMA(prevSeries, visibleCandles, period);
    }
  }

  return result;
}

function findVisibleEndIndex(data: Candle[], targetTime: number) {
  let left = 0;
  let right = data.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (data[mid].time <= targetTime) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}
