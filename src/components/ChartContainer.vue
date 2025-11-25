<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
} from "lightweight-charts";
import { useReplayStore } from "../stores/replayStore";

const chartContainer = ref<HTMLElement | null>(null);
const store = useReplayStore();

let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;

onMounted(async () => {
  if (!chartContainer.value) return;

  // 1. Initialize Chart with AUTO width/height
  chart = createChart(chartContainer.value, {
    layout: {
      background: { color: "#10141f" },
      textColor: "#d1d4dc",
    },
    grid: {
      vertLines: { color: "#1f2937" }, // Darker grid for pro look
      horzLines: { color: "#1f2937" },
    },
    width: chartContainer.value.clientWidth,
    height: chartContainer.value.clientHeight, // Fill container
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
  });

  await store.loadData();

  if (store.visibleCandles.length > 0 && candleSeries) {
    candleSeries.setData(store.visibleCandles);
    chart.timeScale().fitContent();
  }

  window.addEventListener("resize", handleResize);
});

watch(
  () => store.visibleCandles,
  (newCandles) => {
    if (!candleSeries) return;
    const currentLength = newCandles.length;
    if (currentLength > 0) {
      const latestCandle = newCandles[currentLength - 1];
      candleSeries.update(latestCandle);
    }
  },
  { deep: true }
);

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  if (chart) chart.remove();
});

// 2. Resize Logic: Always fill the window
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
  <div class="relative w-screen h-screen bg-[#10141f] overflow-hidden">
    <div ref="chartContainer" class="w-full h-full"></div>

    <div
      class="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-gray-800/90 border border-gray-700 p-2 rounded-lg shadow-xl backdrop-blur-md"
    >
      <button
        @click="store.togglePlay"
        class="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition-colors"
      >
        <span v-if="!store.isPlaying">▶ Play</span>
        <span v-else>⏸ Pause</span>
      </button>

      <div
        class="flex flex-col text-xs text-gray-400 px-2 border-l border-gray-600"
      >
        <span>CANDLES</span>
        <span class="text-white font-mono text-base">
          {{ store.visibleCandles.length }} / {{ store.allCandles.length }}
        </span>
      </div>
    </div>
  </div>
</template>
