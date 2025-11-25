import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { loadCsvData } from "../services/dataLoader";
import type {
  Candle,
  Timeframe,
  IndicatorPoint,
  IndicatorDefinition,
} from "../data/types";
import { calculateSMA, appendSMA } from "../utils/indicators";

const AVAILABLE_TIMEFRAMES: Timeframe[] = ["15m", "1h"];
const TIMEFRAME_STEP_SECONDS: Record<string, number> = {
  "15m": 60 * 15,
  "1h": 60 * 60,
};
const DATA_SYMBOL = "ETHUSDT";
const DATA_YEAR = "2024";
const DATA_FILES: Record<string, string> = {
  "15m": "ETHUSDT-15m-2024-08.csv",
  "1h": "ETHUSDT-1h-2024-08.csv",
};
const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  { id: "sma14", label: "SMA 14", type: "sma", period: 14, color: "#f0b90b" },
  { id: "sma50", label: "SMA 50", type: "sma", period: 50, color: "#1abc9c" },
];

export const useReplayStore = defineStore("replay", () => {
  // --- STATE ---
  // We now map keys (e.g., "1h", "15m") to data arrays
  const datasets = ref<Record<string, Candle[]>>({});
  const visibleDatasets = ref<Record<string, Candle[]>>({});
  const visibleIndicators = ref<
    Record<string, Record<string, IndicatorPoint[]>>
  >({});

  const isPlaying = ref(false);
  const playbackSpeed = ref(100);
  const activeTimeframe = ref<Timeframe>("1h");

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
    const loaded: Record<string, Candle[]> = {};

    await Promise.all(
      AVAILABLE_TIMEFRAMES.map(async (tf) => {
        const file = DATA_FILES[tf];
        if (!file) return;

        loaded[tf] = await loadCsvData(DATA_SYMBOL, tf, DATA_YEAR, file);
      })
    );

    datasets.value = loaded;

    const firstCandle = activeDataset.value[0];
    if (firstCandle) {
      currentReplayTime.value = firstCandle.time;
      updateView();
    }
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
      const filtered = data.filter((c) => c.time <= currentReplayTime.value);
      newVisible[key] = filtered;

      newIndicators[key] = computeIndicatorsForVisible(
        filtered,
        visibleDatasets.value[key] || [],
        visibleIndicators.value[key] || {}
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

  function togglePlay() {
    isPlaying.value = !isPlaying.value;
    if (isPlaying.value) {
      intervalId = setInterval(nextTick, playbackSpeed.value);
    } else if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // Formatted Date for UI
  const currentDate = computed(() => {
    if (!currentReplayTime.value) return "";
    return new Date(currentReplayTime.value * 1000).toLocaleString();
  });

  // For the slider max value
  const totalCandles = computed(() => activeDataset.value.length || 0);

  return {
    availableTimeframes: AVAILABLE_TIMEFRAMES,
    indicatorDefinitions: INDICATOR_DEFINITIONS,
    activeTimeframe,
    datasets,
    visibleDatasets,
    visibleIndicators,
    isPlaying,
    currentReplayTime,
    currentDate,
    totalCandles,
    masterIndex, // Expose index for slider position
    loadData,
    togglePlay,
    jumpTo,
    setActiveTimeframe,
  };
});

function computeIndicatorsForVisible(
  visibleCandles: Candle[],
  previousVisible: Candle[],
  previousIndicators: Record<string, IndicatorPoint[]>
): Record<string, IndicatorPoint[]> {
  const result: Record<string, IndicatorPoint[]> = {};

  const prevLength = previousVisible?.length ?? 0;
  const newLength = visibleCandles.length;
  const hasNewCandle = newLength > prevLength;
  const isReset = newLength < prevLength;
  const isJump = newLength - prevLength > 1;

  for (const definition of INDICATOR_DEFINITIONS) {
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
