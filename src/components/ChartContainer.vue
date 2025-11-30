<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
  LineSeries,
  type MouseEventParams,
  type SeriesDataItemTypeMap,
  type LogicalRange,
  createSeriesMarkers,
  LineStyle,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type CreatePriceLineOptions,
  type Time,
} from "lightweight-charts";
import { useReplayStore } from "../stores/replayStore";
import { useTradingStore } from "../stores/tradingStore";
import ChartLegend from "./ChartLegend.vue";
import type { Candle, IndicatorDefinition } from "../data/types";

const OSCILLATOR_TYPES = new Set(["atr", "rsi", "adx"]);
const HANDLE_HEIGHT = 8;

const props = defineProps<{
  timeframe: string;
}>();

const store = useReplayStore();
const tradingStore = useTradingStore();

const paneRoot = ref<HTMLElement | null>(null);
const mainChartContainer = ref<HTMLElement | null>(null);
const oscillatorChartContainer = ref<HTMLElement | null>(null);
const mainPaneRatio = ref(0.7);
const mainPaneHeight = ref(0);
const oscillatorPaneHeight = ref(0);

const hoveredCandle = ref<Candle | null>(null);
const legendIndicators = ref<
  Array<{ label: string; value: number | null; color: string }>
>([]);
const savedRanges = ref<Record<string, LogicalRange | null>>({});

let mainChart: IChartApi | null = null;
let oscillatorChart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let overlayIndicatorSeries: Record<string, ISeriesApi<"Line">> = {};
let oscillatorIndicatorSeries: Record<string, ISeriesApi<"Line">> = {};
let unsubscribeMainRange: (() => void) | null = null;
let unsubscribeOscRange: (() => void) | null = null;
let isSyncingRange = false;
let tradeMarkersPrimitive: ISeriesMarkersPluginApi<Time> | null = null;
let clickHandler: ((param: MouseEventParams) => void) | null = null;
let orderPriceLines: Record<number, IPriceLine> = {};
let isPaneResizing = false;
let resizeStartY = 0;
let resizeStartRatio = 0;
let paneResizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  await nextTick();
  recomputePaneHeights();
  if (!mainChartContainer.value || !oscillatorChartContainer.value) return;

  mainChart = createChart(mainChartContainer.value, {
    layout: { background: { color: "#10141f" }, textColor: "#d1d4dc" },
    grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
    width: mainChartContainer.value.clientWidth,
    height: mainChartContainer.value.clientHeight,
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5 },
    crosshair: { mode: 1 },
  });

  oscillatorChart = createChart(oscillatorChartContainer.value, {
    layout: { background: { color: "#0d111d" }, textColor: "#d1d4dc" },
    grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
    width: oscillatorChartContainer.value.clientWidth,
    height: oscillatorChartContainer.value.clientHeight,
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5 },
    crosshair: { mode: 1 },
  });

  candleSeries = mainChart.addSeries(CandlestickSeries, {
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
  });
  tradeMarkersPrimitive = createSeriesMarkers(candleSeries, []);

  overlayIndicatorSeries = {};
  oscillatorIndicatorSeries = {};
  for (const indicator of store.indicatorDefinitions) {
    const targetChart = isOscillator(indicator) ? oscillatorChart : mainChart;
    if (!targetChart) continue;
    const series = targetChart.addSeries(LineSeries, {
      color: indicator.color,
      lineWidth: (indicator.lineWidth ?? 2) as LineWidth,
      crosshairMarkerVisible: false,
    });
    if (isOscillator(indicator)) {
      oscillatorIndicatorSeries[indicator.id] = series;
    } else {
      overlayIndicatorSeries[indicator.id] = series;
    }
  }

  clickHandler = (param: MouseEventParams) => {
    if (!store.isSelectingReplay || !param.time) return;
    if (typeof param.time === "number") {
      store.setReplayStart(param.time);
    }
  };
  mainChart.subscribeClick(clickHandler);

  mainChart.subscribeCrosshairMove((param: MouseEventParams) => {
    if (!param.time || !candleSeries) {
      updateLegendToLatest();
      return;
    }
    const data = param.seriesData.get(
      candleSeries
    ) as SeriesDataItemTypeMap["Candlestick"] | undefined;
    if (data) {
      hoveredCandle.value = { ...data } as Candle;
    }
  });

  if (Object.keys(store.datasets).length === 0) {
    await store.loadData();
  }

  initChartData();
  initIndicatorData();
  updateTradeMarkers();
  updatePendingOrderLines();

  const mainTimeScale = mainChart.timeScale();
  const oscillatorTimeScale = oscillatorChart.timeScale();
  const handleMainRangeChange = (range: LogicalRange | null) => {
    if (!range || isSyncingRange) return;
    savedRanges.value[props.timeframe] = { ...range };
    setOscillatorRange(range);
  };
  const handleOscillatorRangeChange = (range: LogicalRange | null) => {
    if (!range || isSyncingRange) return;
    savedRanges.value[props.timeframe] = { ...range };
    setMainRange(range);
  };
  mainTimeScale.subscribeVisibleLogicalRangeChange(handleMainRangeChange);
  oscillatorTimeScale.subscribeVisibleLogicalRangeChange(handleOscillatorRangeChange);
  unsubscribeMainRange = () =>
    mainTimeScale.unsubscribeVisibleLogicalRangeChange(handleMainRangeChange);
  unsubscribeOscRange = () =>
    oscillatorTimeScale.unsubscribeVisibleLogicalRangeChange(
      handleOscillatorRangeChange
    );

  paneResizeObserver = new ResizeObserver(() => {
    recomputePaneHeights();
    resizeCharts();
  });
  if (paneRoot.value && paneResizeObserver) {
    paneResizeObserver.observe(paneRoot.value);
  }

  window.addEventListener("resize", handleResize);
});

function isOscillator(definition: IndicatorDefinition) {
  return OSCILLATOR_TYPES.has(definition.type);
}

function setMainRange(range: LogicalRange) {
  if (!mainChart) return;
  isSyncingRange = true;
  mainChart.timeScale().setVisibleLogicalRange(range);
  isSyncingRange = false;
}

function setOscillatorRange(range: LogicalRange) {
  if (!oscillatorChart) return;
  isSyncingRange = true;
  oscillatorChart.timeScale().setVisibleLogicalRange(range);
  isSyncingRange = false;
}

function recomputePaneHeights() {
  if (!paneRoot.value) return;
  const totalHeight = paneRoot.value.clientHeight;
  const chartSpace = Math.max(totalHeight - HANDLE_HEIGHT, 0);
  mainPaneHeight.value = chartSpace * mainPaneRatio.value;
  oscillatorPaneHeight.value = chartSpace * (1 - mainPaneRatio.value);
}

function beginPaneResize(event: MouseEvent) {
  if (!paneRoot.value) return;
  isPaneResizing = true;
  resizeStartY = event.clientY;
  resizeStartRatio = mainPaneRatio.value;
  document.addEventListener("mousemove", handlePaneResizeMove);
  document.addEventListener("mouseup", endPaneResize);
  event.preventDefault();
}

function handlePaneResizeMove(event: MouseEvent) {
  if (!isPaneResizing || !paneRoot.value) return;
  const usableHeight = Math.max(paneRoot.value.clientHeight - HANDLE_HEIGHT, 0);
  if (usableHeight <= 0) return;
  const deltaRatio = (event.clientY - resizeStartY) / usableHeight;
  const nextRatio = Math.min(0.9, Math.max(0.2, resizeStartRatio + deltaRatio));
  mainPaneRatio.value = nextRatio;
  recomputePaneHeights();
  resizeCharts();
}

function endPaneResize() {
  if (!isPaneResizing) return;
  isPaneResizing = false;
  document.removeEventListener("mousemove", handlePaneResizeMove);
  document.removeEventListener("mouseup", endPaneResize);
}

function updateLegendToLatest() {
  const data = store.visibleDatasets[props.timeframe];
  const latest = data?.[data.length - 1];
  hoveredCandle.value = latest ?? null;
  updateIndicatorLegendValues(latest?.time);
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

function initIndicatorData() {
  const indicatorMap = store.visibleIndicators[props.timeframe] || {};
  for (const indicator of store.indicatorDefinitions) {
    const series = getSeriesForIndicator(indicator);
    if (!series) continue;
    series.setData(indicatorMap[indicator.id] || []);
  }
  updateIndicatorLegendValues();
}

function getSeriesForIndicator(indicator: IndicatorDefinition) {
  return isOscillator(indicator)
    ? oscillatorIndicatorSeries[indicator.id]
    : overlayIndicatorSeries[indicator.id];
}

function saveCurrentRange(timeframe: string) {
  if (!mainChart) return;
  const range = mainChart.timeScale().getVisibleLogicalRange();
  if (range) {
    savedRanges.value[timeframe] = { ...range };
  }
}

function applySavedRangeOrFit() {
  if (!mainChart) return;
  const range = savedRanges.value[props.timeframe];
  if (range) {
    setMainRange(range);
    setOscillatorRange(range);
  } else {
    mainChart.timeScale().fitContent();
    const fittedRange = mainChart.timeScale().getVisibleLogicalRange();
    if (fittedRange) {
      setOscillatorRange(fittedRange);
      savedRanges.value[props.timeframe] = { ...fittedRange };
    }
  }
}

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

    updateLegendToLatest();
  }
);

watch(
  () => props.timeframe,
  (_newTf, oldTf) => {
    if (oldTf) {
      saveCurrentRange(oldTf);
    }
    initChartData();
    initIndicatorData();
  }
);

watch(
  () => store.visibleIndicators[props.timeframe],
  (newIndicators, oldIndicators) => {
    for (const indicator of store.indicatorDefinitions) {
      const series = getSeriesForIndicator(indicator);
      if (!series) continue;

      const nextData = newIndicators?.[indicator.id] || [];
      const prevData = oldIndicators?.[indicator.id] || [];

      if (nextData.length === 0) {
        series.setData([]);
        continue;
      }

      const isReset = nextData.length <= prevData.length;
      const isJump = nextData.length - prevData.length > 1;

      if (isReset || isJump) {
        series.setData(nextData);
      } else {
        const latest = nextData[nextData.length - 1];
        if (latest) {
          series.update(latest);
        }
      }
    }
    updateIndicatorLegendValues();
    updateTradeMarkers();
  }
);

watch(
  () => tradingStore.tradeMarkers,
  () => {
    updateTradeMarkers();
  }
);

watch(
  () => tradingStore.pendingOrders,
  () => {
    updatePendingOrderLines();
  }
);

watch(mainPaneRatio, () => {
  if (isPaneResizing) return;
  recomputePaneHeights();
  resizeCharts();
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  endPaneResize();
  if (paneResizeObserver && paneRoot.value) {
    paneResizeObserver.unobserve(paneRoot.value);
    paneResizeObserver.disconnect();
    paneResizeObserver = null;
  }
  if (unsubscribeMainRange) {
    unsubscribeMainRange();
    unsubscribeMainRange = null;
  }
  if (unsubscribeOscRange) {
    unsubscribeOscRange();
    unsubscribeOscRange = null;
  }
  if (tradeMarkersPrimitive) {
    tradeMarkersPrimitive.setMarkers([]);
    tradeMarkersPrimitive = null;
  }
  if (mainChart && clickHandler) {
    mainChart.unsubscribeClick(clickHandler);
  }
  clearPendingOrderLines();
  if (mainChart) {
    mainChart.remove();
  }
  if (oscillatorChart) {
    oscillatorChart.remove();
  }
  clickHandler = null;
});

function handleResize() {
  recomputePaneHeights();
  resizeCharts();
}

function resizeCharts() {
  if (mainChart && mainChartContainer.value) {
    mainChart.applyOptions({
      width: mainChartContainer.value.clientWidth,
      height: mainChartContainer.value.clientHeight,
    });
  }
  if (oscillatorChart && oscillatorChartContainer.value) {
    oscillatorChart.applyOptions({
      width: oscillatorChartContainer.value.clientWidth,
      height: oscillatorChartContainer.value.clientHeight,
    });
  }
}

function updateIndicatorLegendValues(targetTime?: number) {
  const indicatorMap = store.visibleIndicators[props.timeframe] || {};
  const activeIndicators = store.indicatorDefinitions.filter((definition) =>
    store.isIndicatorActive(definition.id)
  );

  const nextLegendValues = activeIndicators.map((definition) => {
    const points = indicatorMap[definition.id] || [];
    const latestPoint = targetTime
      ? [...points].reverse().find((point) => point.time <= targetTime)
      : points[points.length - 1];

    return {
      label: definition.label,
      value: latestPoint?.value ?? null,
      color: definition.color,
    };
  });

  legendIndicators.value = nextLegendValues;
}

function updateTradeMarkers() {
  if (!tradeMarkersPrimitive) return;
  const markers = tradingStore.tradeMarkers.map((marker) => ({
    time: marker.time,
    position: marker.position,
    shape: marker.shape,
    color: marker.color,
    text: marker.text,
  }));
  tradeMarkersPrimitive.setMarkers(markers);
}

function updatePendingOrderLines() {
  if (!candleSeries) return;
  const activeOrders = tradingStore.pendingOrders;
  const existingIds = new Set(Object.keys(orderPriceLines).map((id) => Number(id)));

  for (const order of activeOrders) {
    const color = order.side === "long" ? "#26a69a" : "#ef5350";
    const label = `${order.side === "long" ? "Buy" : "Sell"} ${order.orderType.toUpperCase()}`;
    const lineOptions: CreatePriceLineOptions = {
      price: order.price,
      color,
      lineStyle: LineStyle.Dashed,
      lineWidth: 1 as LineWidth,
      axisLabelVisible: true,
      title: label,
    };

    const existingLine = orderPriceLines[order.id];
    if (existingLine) {
      existingLine.applyOptions(lineOptions);
    } else {
      orderPriceLines[order.id] = candleSeries.createPriceLine(lineOptions);
    }

    existingIds.delete(order.id);
  }

  existingIds.forEach((id) => {
    const line = orderPriceLines[id];
    if (line && candleSeries) {
      candleSeries.removePriceLine(line);
    }
    delete orderPriceLines[id];
  });
}

function clearPendingOrderLines() {
  if (!candleSeries) {
    orderPriceLines = {};
    return;
  }
  for (const line of Object.values(orderPriceLines)) {
    candleSeries.removePriceLine(line);
  }
  orderPriceLines = {};
}
</script>

<template>
  <div
    ref="paneRoot"
    class="relative w-full h-full bg-[#10141f] overflow-hidden border-r border-gray-800"
    :class="store.isSelectingReplay ? 'cursor-crosshair ring-1 ring-blue-500/50' : ''"
  >
    <div
      v-if="store.isSelectingReplay"
      class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
    >
      <div class="px-3 py-2 bg-blue-600/90 text-xs font-semibold rounded shadow-lg">
        Click a candle to start replay
      </div>
    </div>

    <ChartLegend
      :candle="hoveredCandle"
      :symbol="store.activeSymbol"
      :interval="timeframe"
      :indicators="legendIndicators"
    />

    <div class="absolute inset-0 flex flex-col">
      <div
        class="relative w-full"
        :style="{ height: `${mainPaneHeight}px`, minHeight: '160px' }"
      >
        <div ref="mainChartContainer" class="w-full h-full"></div>
      </div>

      <div
        class="h-2 bg-gray-800/80 hover:bg-gray-700/80 text-[10px] uppercase tracking-[0.3em] text-gray-400 flex items-center justify-center cursor-row-resize select-none"
        @mousedown="beginPaneResize"
      >
        Drag
      </div>

      <div
        class="relative w-full"
        :style="{ height: `${oscillatorPaneHeight}px`, minHeight: '120px' }"
      >
        <div ref="oscillatorChartContainer" class="w-full h-full"></div>
      </div>
    </div>
  </div>
</template>
