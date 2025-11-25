<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
  type MouseEventParams,
  type SeriesDataItemTypeMap,
  type LogicalRange,
} from "lightweight-charts";
import { useReplayStore } from "../stores/replayStore";
import ChartLegend from "./ChartLegend.vue";
import type { Candle } from "../data/types";

// Props to make this component reusable for MTF
const props = defineProps<{
  timeframe: string; // "1h" or "15m"
}>();

const chartContainer = ref<HTMLElement | null>(null);
const store = useReplayStore();

// Local state for the Legend
const hoveredCandle = ref<Candle | null>(null);
const savedRanges = ref<Record<string, LogicalRange | null>>({});

let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let unsubscribeRangeWatcher: (() => void) | null = null;

onMounted(async () => {
  if (!chartContainer.value) return;

  chart = createChart(chartContainer.value, {
    layout: { background: { color: "#10141f" }, textColor: "#d1d4dc" },
    grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
    width: chartContainer.value.clientWidth,
    height: chartContainer.value.clientHeight,
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5 },
    crosshair: { mode: 1 }, // Magnet mode
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
  });

  // --- LEGEND LOGIC ---
  // Subscribe to crosshair moves to update Legend
  chart.subscribeCrosshairMove((param: MouseEventParams) => {
    if (!param.time || !candleSeries) {
      // If mouse leaves chart, revert to latest candle
      updateLegendToLatest();
      return;
    }

    // Get data for the hovered position
    const data = param.seriesData.get(
      candleSeries
    ) as SeriesDataItemTypeMap["Candlestick"] | undefined;
    if (data) {
      hoveredCandle.value = { ...data } as Candle;
    }
  });

  // Initial Load
  if (Object.keys(store.datasets).length === 0) {
    await store.loadData();
  }

  initChartData();
  const timeScale = chart.timeScale();
  const handleRangeChange = (range: LogicalRange | null) => {
    if (!range) return;
    savedRanges.value[props.timeframe] = { ...range };
  };
  timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
  unsubscribeRangeWatcher = () =>
    timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
  window.addEventListener("resize", handleResize);
});

function updateLegendToLatest() {
  const data = store.visibleDatasets[props.timeframe];
  const latest = data?.[data.length - 1];
  hoveredCandle.value = latest ?? null;
}

function initChartData() {
  if (!candleSeries) return;
  const data = store.visibleDatasets[props.timeframe];
  if (data && data.length > 0) {
    candleSeries.setData(data);
    applySavedRangeOrFit();
    updateLegendToLatest();
  }
}

function saveCurrentRange(timeframe: string) {
  if (!chart) return;
  const range = chart.timeScale().getVisibleLogicalRange();
  if (range) {
    savedRanges.value[timeframe] = { ...range };
  }
}

function applySavedRangeOrFit() {
  if (!chart) return;
  const range = savedRanges.value[props.timeframe];
  if (range) {
    chart.timeScale().setVisibleLogicalRange(range);
  } else {
    chart.timeScale().fitContent();
  }
}

// Watch the SPECIFIC timeframe dataset
watch(
  () => store.visibleDatasets[props.timeframe],
  (newData, oldData) => {
    if (!candleSeries || !newData) return;

    const isReset = !oldData || newData.length < oldData.length;
    const isJump = oldData && newData.length - oldData.length > 1;

    if (isReset || isJump) {
      candleSeries.setData(newData);
      applySavedRangeOrFit();
    } else if (newData.length > 0) {
      const latest = newData[newData.length - 1];
      if (latest) {
        candleSeries.update(latest);
      }
    }

    // Update legend if we are not hovering
    updateLegendToLatest();
  },
  { deep: true }
);

watch(
  () => props.timeframe,
  (newTf, oldTf) => {
    if (oldTf) {
      saveCurrentRange(oldTf);
    }
    initChartData();
  }
);

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  if (unsubscribeRangeWatcher) {
    unsubscribeRangeWatcher();
    unsubscribeRangeWatcher = null;
  }
  if (chart) chart.remove();
});

function handleResize() {
  if (chart && chartContainer.value) {
    chart.applyOptions({
      width: chartContainer.value.clientWidth,
      height: chartContainer.value.clientHeight,
    });
  }
}
</script>

<template>
  <div
    class="relative w-full h-full bg-[#10141f] overflow-hidden border-r border-gray-800"
  >
    <!-- The Legend Overlay -->
    <ChartLegend
      :candle="hoveredCandle"
      symbol="ETHUSDT"
      :interval="timeframe"
    />

    <!-- The Chart -->
    <div ref="chartContainer" class="w-full h-full"></div>
  </div>
</template>
