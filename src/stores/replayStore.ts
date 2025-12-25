import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { fetchManifest, loadCsvData } from "../services/dataLoader";
import type { DataManifest } from "../services/dataLoader";
import type {
  Candle,
  Timeframe,
  IndicatorPoint,
} from "../data/types";
import { useTradingStore } from "./tradingStore";
import { INDICATOR_DEFINITIONS } from "../indicators/definitions";
import { createIndicatorInstance } from "../indicators/factory";
import type { IndicatorStrategy } from "../indicators/types";

const TIMEFRAME_STEP_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 60 * 5,
  "15m": 60 * 15,
  "30m": 60 * 30,
  "1h": 60 * 60,
  "4h": 60 * 60 * 4,
  "1d": 60 * 60 * 24,
};
type IndicatorState = Record<string, boolean>;
type IndicatorSettingsState = Record<string, { color?: string }>;
const INDICATOR_STORAGE_KEY = "indicatorSettings";

const defaultIndicatorState: IndicatorState = INDICATOR_DEFINITIONS.reduce(
  (acc, indicator) => {
    acc[indicator.id] = indicator.defaultActive ?? true;
    return acc;
  },
  {} as IndicatorState
);

export const useReplayStore = defineStore("replay", () => {
  // --- STATE ---
  const tradingStore = useTradingStore();
  const datasets = ref<Record<string, Candle[]>>({});
  const visibleDatasets = ref<Record<string, Candle[]>>({});
  const visibleIndicators = ref<
    Record<string, Record<string, IndicatorPoint[]>>
  >({});
  const indicatorSeries = ref<Record<string, Record<string, IndicatorPoint[]>>>(
    {}
  );
  const availableTimeframes = ref<Timeframe[]>([]);
  const dataManifest = ref<DataManifest | null>(null);
  const activeSymbol = ref<string>("ETHUSDT");
  const indicatorInstances = ref<
    Record<string, Record<string, IndicatorStrategy>>
  >({});
  const indicatorSettings = ref<IndicatorSettingsState>({});
  loadIndicatorSettings();

  function loadIndicatorSettings() {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(INDICATOR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as IndicatorSettingsState;
        indicatorSettings.value = parsed ?? {};
      }
    } catch (error) {
      console.warn("Failed to load indicator settings", error);
    }
  }

  function persistIndicatorSettings() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        INDICATOR_STORAGE_KEY,
        JSON.stringify(indicatorSettings.value)
      );
    } catch (error) {
      console.warn("Failed to persist indicator settings", error);
    }
  }

  function isValidHexColor(value: string | undefined | null) {
    if (!value) return false;
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
  }

  function setIndicatorColor(id: string, color: string) {
    if (!isValidHexColor(color)) return;
    indicatorSettings.value = {
      ...indicatorSettings.value,
      [id]: { ...(indicatorSettings.value[id] ?? {}), color },
    };
    persistIndicatorSettings();
  }

  const decoratedIndicatorDefinitions = computed(() =>
    INDICATOR_DEFINITIONS.map((definition) => ({
      ...definition,
      color: isValidHexColor(indicatorSettings.value[definition.id]?.color)
        ? indicatorSettings.value[definition.id]?.color
        : definition.color,
    }))
  );

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

    const timeframes = Object.keys(symbolManifest).sort() as Timeframe[];
    availableTimeframes.value = timeframes;
    if (!timeframes.includes(activeTimeframe.value)) {
      activeTimeframe.value = timeframes[0] ?? "1h";
    }

    const loaded: Record<string, Candle[]> = {};

    await Promise.all(
      availableTimeframes.value.map(async (tf) => {
        const files = symbolManifest[tf] || [];
        if (files.length === 0) {
          loaded[tf] = [];
          return;
        }

        const results = await Promise.all(
          files.map((filePath) => loadCsvData(filePath))
        );
        const merged = results.flat().sort((a, b) => a.time - b.time);
        loaded[tf] = merged;
      })
    );

    datasets.value = loaded;
    syncIndicatorInstancesWithState();
    resetIndicatorInstances();

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

  const availableSymbols = computed(() =>
    Object.keys(dataManifest.value || {})
  );

  async function setSymbol(symbol: string) {
    if (symbol === activeSymbol.value) return;
    activeSymbol.value = symbol;
    datasets.value = {};
    visibleDatasets.value = {};
    visibleIndicators.value = {};
    resetIndicatorInstances();
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
    const timeframesToProcess = getTimeframesToProcess();
    const newVisible: Record<string, Candle[]> = {
      ...visibleDatasets.value,
    };
    const newIndicatorSeries: Record<string, Record<string, IndicatorPoint[]>> =
      {
        ...indicatorSeries.value,
      };
    const newVisibleIndicators: Record<
      string,
      Record<string, IndicatorPoint[]>
    > = {
      ...visibleIndicators.value,
    };

    for (const key of timeframesToProcess) {
      const data = datasets.value[key] || [];
      // Filter ALL datasets based on the Master Clock
      // Binary search would be faster here for large datasets,
      // but filter is fine for <10k items
      const cutoffIndex = findVisibleEndIndex(data, currentReplayTime.value);
      const filtered =
        cutoffIndex >= 0 ? data.slice(0, cutoffIndex + 1) : ([] as Candle[]);
      newVisible[key] = filtered;

      const computedIndicators = computeIndicatorsForVisible(
        key,
        filtered,
        visibleDatasets.value[key] || [],
        indicatorSeries.value[key] || {}
      );

      newIndicatorSeries[key] = computedIndicators;
      newVisibleIndicators[key] =
        filterIndicatorsForDisplay(computedIndicators);
    }

    visibleDatasets.value = newVisible;
    indicatorSeries.value = newIndicatorSeries;
    visibleIndicators.value = newVisibleIndicators;

  }

  function getTimeframesToProcess(): Timeframe[] {
    return [activeTimeframe.value];
  }

  function computeIndicatorsForVisible(
    timeframe: string,
    visibleCandles: Candle[],
    previousVisible: Candle[],
    previousIndicators: Record<string, IndicatorPoint[]>
  ): Record<string, IndicatorPoint[]> {
    const result: Record<string, IndicatorPoint[]> = {};
    const instances = indicatorInstances.value[timeframe] || {};

    const prevLength = previousVisible?.length ?? 0;
    const newLength = visibleCandles.length;
    const hasNewCandle = newLength > prevLength;
    const isReset = newLength < prevLength;
    const isJump = newLength - prevLength > 1;

    for (const [id, instance] of Object.entries(instances)) {
      if (newLength === 0) {
        instance.reset();
        result[id] = [];
        continue;
      }

      const prevSeries = previousIndicators?.[id] || [];

      if (isReset || isJump || prevSeries.length === 0) {
        instance.reset();
        result[id] = instance.calculate(visibleCandles);
        continue;
      }

      if (hasNewCandle) {
        const latest = visibleCandles[newLength - 1];
        if (latest) {
          instance.update(latest);
        }
        result[id] = instance.getSeries();
        continue;
      } else {
        // Handle intra-bar price updates when no new candle is added
        const latest = visibleCandles[newLength - 1];
        if (latest) {
          instance.update(latest);
        }
        result[id] = instance.getSeries();
        continue;
      }
    }

    return result;
  }

  function jumpTo(index: number) {
    const active = datasets.value[activeTimeframe.value];
    if (!active || !active[index]) return;

    // Jump clock to the specific candle's time
    currentReplayTime.value = active[index].time;
    updateView();
  }

  function jumpToTimestamp(timestamp: number) {
    const active = datasets.value[activeTimeframe.value];
    if (!active || active.length === 0) return;
    let left = 0;
    let right = active.length - 1;
    let closestIndex = 0;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midTime = active[mid]?.time;
      if (midTime == null) {
        break;
      }
      if (midTime === timestamp) {
        closestIndex = mid;
        break;
      }
      const closestTime = active[closestIndex]?.time;
      if (
        closestTime != null &&
        Math.abs(midTime - timestamp) < Math.abs(closestTime - timestamp)
      ) {
        closestIndex = mid;
      }
      if (midTime < timestamp) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    const targetTime = active[closestIndex]?.time;
    if (targetTime == null) return;
    currentReplayTime.value = targetTime;
    updateView();
  }

  function stepForward() {
    const active = datasets.value[activeTimeframe.value];
    if (!active || active.length === 0) return;
    const currentIndex = findVisibleEndIndex(
      active,
      currentReplayTime.value
    );
    const nextIndex = currentIndex + 1;
    if (!active[nextIndex]) return;
    currentReplayTime.value = active[nextIndex].time;
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
    syncIndicatorInstancesWithState();
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
    decoratedIndicatorDefinitions.value.filter(
      (def) => activeIndicators.value[def.id]
    )
  );

  function syncIndicatorInstancesWithState() {
    for (const timeframe of availableTimeframes.value) {
      if (!indicatorInstances.value[timeframe]) {
        indicatorInstances.value[timeframe] = {};
      }
      const instanceMap = indicatorInstances.value[timeframe];

      for (const definition of INDICATOR_DEFINITIONS) {
        if (!instanceMap[definition.id]) {
          instanceMap[definition.id] = createIndicatorInstance(definition);
        }
      }
    }
  }

  function filterIndicatorsForDisplay(
    series: Record<string, IndicatorPoint[]>
  ): Record<string, IndicatorPoint[]> {
    const filtered: Record<string, IndicatorPoint[]> = {};
    for (const [id, points] of Object.entries(series)) {
      if (activeIndicators.value[id]) {
        filtered[id] = points;
      }
    }
    return filtered;
  }

  function resetIndicatorInstances() {
    for (const timeframeInstances of Object.values(indicatorInstances.value)) {
      for (const instance of Object.values(timeframeInstances)) {
        instance.reset();
      }
    }
  }
  syncIndicatorInstancesWithState();

  return {
    availableTimeframes,
    indicatorDefinitions: decoratedIndicatorDefinitions,
    setIndicatorColor,
    indicatorSettings,
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
    jumpToTimestamp,
    stepForward,
    setSymbol,
    toggleReplaySelection,
    setReplayStart,
    setActiveTimeframe,
    toggleIndicator,
    isIndicatorActive,
    setPlaybackInterval,
  };
});

function findVisibleEndIndex(data: Candle[], targetTime: number) {
  let left = 0;
  let right = data.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const candle = data[mid];
    if (!candle) {
      break;
    }
    if (candle.time <= targetTime) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}
