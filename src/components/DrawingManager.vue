<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import type {
  IChartApi,
  ISeriesApi,
} from "lightweight-charts";
import DrawingToolbar from "./DrawingToolbar.vue";
import DrawingOverlay from "./DrawingOverlay.vue";
import DrawingPropertiesPanel from "./DrawingPropertiesPanel.vue";
import { useDrawingStore } from "../stores/drawingStore";
import type { Candle } from "../data/types";

const props = defineProps<{
  symbol: string;
  timeframe: string;
  dataset: Candle[];
  mainChart: IChartApi | null;
  mainSeries: ISeriesApi<"Candlestick"> | null;
  mainContainer: HTMLElement | null;
  paneChart: IChartApi | null;
  paneSeries: ISeriesApi<any> | null;
  paneContainer: HTMLElement | null;
}>();

const drawingStore = useDrawingStore();

watch(
  () => [props.symbol, props.timeframe],
  ([symbol, timeframe]) => {
    if (symbol && timeframe) {
      drawingStore.setContext(symbol, timeframe);
    }
  },
  { immediate: true }
);

const hasPaneOverlay = computed(
  () => !!(props.paneChart && props.paneSeries && props.paneContainer)
);

const shouldShowProperties = computed(() => !!drawingStore.selectedDrawing);
const activePaneTarget = computed(
  () => drawingStore.activeToolDefinition?.paneTarget ?? "main"
);

function handleKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      drawingStore.redoLast();
    } else {
      drawingStore.undoLast();
    }
    return;
  }

  if (event.key === "Escape") {
    drawingStore.setSelectedTool("cursor");
    drawingStore.setSelectedDrawing(null);
    return;
  }

  if ((event.key === "Delete" || event.key === "Backspace") && drawingStore.selectedDrawingId) {
    drawingStore.removeDrawing(drawingStore.selectedDrawingId);
    event.preventDefault();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="absolute inset-0 pointer-events-none select-none">
    <DrawingToolbar class="pointer-events-auto" />

    <DrawingOverlay
      pane-id="main"
      :chart="mainChart"
      :series="mainSeries"
      :container="mainContainer"
      :dataset="dataset"
      :is-active="activePaneTarget === 'main'"
    />

    <DrawingOverlay
      v-if="hasPaneOverlay"
      pane-id="indicator"
      :chart="paneChart"
      :series="paneSeries"
      :container="paneContainer"
      :dataset="dataset"
      :is-active="activePaneTarget === 'indicator'"
    />

    <DrawingPropertiesPanel
      v-if="shouldShowProperties"
      class="pointer-events-auto"
    />
  </div>
</template>
