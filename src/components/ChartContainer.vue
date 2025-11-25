<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
// 1. Import CandlestickSeries here
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

  chart = createChart(chartContainer.value, {
    layout: {
      background: { color: "#10141f" },
      textColor: "#d1d4dc",
    },
    grid: {
      vertLines: { color: "#2b2b43" },
      horzLines: { color: "#2b2b43" },
    },
    width: chartContainer.value.clientWidth,
    height: 500,
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
    },
  });

  // 2. THIS IS THE FIX FOR VERSION 5+
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
  if (chart) {
    chart.remove();
  }
});

function handleResize() {
  if (chart && chartContainer.value) {
    chart.applyOptions({ width: chartContainer.value.clientWidth });
  }
}
</script>

<template>
  <div class="p-4 bg-gray-900 min-h-screen text-white">
    <h1 class="text-xl font-bold mb-4">Bar Replay POC</h1>

    <div class="relative border border-gray-700 rounded-lg overflow-hidden">
      <div ref="chartContainer" class="w-full h-[500px]"></div>

      <div
        class="absolute top-4 left-4 z-10 flex items-center gap-4 bg-gray-800/80 p-2 rounded backdrop-blur"
      >
        <button
          @click="store.togglePlay"
          class="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500 font-bold transition"
        >
          {{ store.isPlaying ? "PAUSE" : "PLAY" }}
        </button>

        <div class="text-sm">
          Candles: {{ store.visibleCandles.length }} /
          {{ store.allCandles.length }}
        </div>
      </div>
    </div>
  </div>
</template>
