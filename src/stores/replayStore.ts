import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { loadCsvData } from "../services/dataLoader";
import type { Candle, Timeframe } from "../data/types";

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

export const useReplayStore = defineStore("replay", () => {
  // --- STATE ---
  // We now map keys (e.g., "1h", "15m") to data arrays
  const datasets = ref<Record<string, Candle[]>>({});
  const visibleDatasets = ref<Record<string, Candle[]>>({});

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

    for (const [key, data] of Object.entries(datasets.value)) {
      // Binary search would be faster here for large datasets,
      // but filter is fine for <10k items
      newVisible[key] = data.filter((c) => c.time <= currentReplayTime.value);
    }

    visibleDatasets.value = newVisible;
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
    activeTimeframe,
    datasets,
    visibleDatasets,
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
