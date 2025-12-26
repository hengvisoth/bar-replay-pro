<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from "vue";
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
import DrawingManager from "./DrawingManager.vue";
import type { Candle, IndicatorDefinition, IndicatorType } from "../data/types";

const HANDLE_HEIGHT = 8;
const PANE_INDICATOR_TYPES = new Set<IndicatorType>(["atr", "adx", "rsi"]);
const SNAPSHOT_CANDLE_COUNT = 100;
const TIMEFRAME_DEFAULT_RANGE = {
  "1h": { min: 120, max: 168 },
  "15m": { min: 195, max: 250 },
} as const;
type CrosshairSeries = ISeriesApi<"Line"> | ISeriesApi<"Candlestick">;
type CrosshairTarget = {
  series: CrosshairSeries;
  price: number;
};

const props = defineProps<{
  timeframe: string;
}>();

const store = useReplayStore();
const tradingStore = useTradingStore();

const paneRoot = ref<HTMLElement | null>(null);
const mainChartContainer = ref<HTMLElement | null>(null);
const paneChartContainer = ref<HTMLElement | null>(null);
const drawingChart = ref<IChartApi | null>(null);
const drawingSeries = ref<ISeriesApi<"Candlestick"> | null>(null);
const paneReferenceSeries = ref<ISeriesApi<"Line"> | null>(null);
const mainPaneRatio = ref(0.7);
const mainPaneHeight = ref(0);
const paneHeight = ref(0);

const hoveredCandle = ref<Candle | null>(null);
const legendIndicators = ref<
  Array<{ label: string; value: number | null; color: string }>
>([]);
const paneLegendIndicators = ref<
  Array<{ label: string; value: number | null; color: string }>
>([]);
const savedRanges = ref<Record<string, LogicalRange | null>>({});
const defaultRanges = ref<Record<string, LogicalRange | null>>({});
const preferredRangeSpan = ref<number | null>(null);
const snapshotStatus = ref<"idle" | "copying" | "copied" | "error">("idle");
const snapshotError = ref("");

let mainChart: IChartApi | null = null;
let paneChart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let overlayIndicatorSeries: Record<string, ISeriesApi<"Line">> = {};
let paneIndicatorSeries: Record<string, ISeriesApi<"Line">> = {};
let unsubscribeMainRange: (() => void) | null = null;
let unsubscribePaneRange: (() => void) | null = null;
let isSyncingRange = false;
let tradeMarkersPrimitive: ISeriesMarkersPluginApi<Time> | null = null;
let clickHandler: ((param: MouseEventParams) => void) | null = null;
let orderPriceLines: Record<number, IPriceLine> = {};
let isPaneResizing = false;
let resizeStartY = 0;
let resizeStartRatio = 0;
let paneResizeObserver: ResizeObserver | null = null;
let rangeSyncFrame: number | null = null;
let pendingRange: LogicalRange | null = null;
let rangeSyncSource: "main" | "pane" | null = null;
let snapshotStatusTimeout: number | null = null;

const hasPaneIndicators = computed(() =>
  store.activeIndicatorDefinitions.some(
    (def) => isPaneIndicator(def) && store.isIndicatorActive(def.id)
  )
);
const activeDatasetForTimeframe = computed(
  () => store.visibleDatasets[props.timeframe] || []
);

onMounted(async () => {
  await nextTick();
  recomputePaneHeights();
  if (!mainChartContainer.value) return;

  console.log("Chart Container Height ", mainChartContainer.value.clientHeight);
  console.log("Chart Container Width ", mainChartContainer.value.clientWidth);
  mainChart = createChart(mainChartContainer.value, {
    layout: { background: { color: "#050505" }, textColor: "#d1d4dc" },
    grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
    width: mainChartContainer.value.clientWidth,
    height: mainChartContainer.value.clientHeight,
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5 },
    crosshair: { mode: 1 },
  });
  drawingChart.value = mainChart;

  if (paneChartContainer.value) {
    paneChart = createChart(paneChartContainer.value, {
      layout: { background: { color: "#050505" }, textColor: "#d1d4dc" },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      width: paneChartContainer.value.clientWidth,
      height: paneChartContainer.value.clientHeight,
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5 },
      crosshair: { mode: 1 },
    });
  }

  candleSeries = mainChart.addSeries(CandlestickSeries, {
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
  });
  drawingSeries.value = candleSeries;
  tradeMarkersPrimitive = createSeriesMarkers(candleSeries, []);

  overlayIndicatorSeries = {};
  paneIndicatorSeries = {};
  for (const indicator of store.indicatorDefinitions) {
    const isPane = isPaneIndicator(indicator);
    const targetChart = isPane ? paneChart : mainChart;
    if (!targetChart) continue;
    const series = targetChart.addSeries(LineSeries, {
      color: indicator.color,
      lineWidth: (indicator.lineWidth ?? 2) as LineWidth,
      crosshairMarkerVisible: false,
    });
    if (isPane) {
      paneIndicatorSeries[indicator.id] = series;
      if (!paneReferenceSeries.value) {
        paneReferenceSeries.value = series;
      }
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

  const handleHoverAtTime = (time: Time | null | undefined) => {
    const numericTime = typeof time === "number" ? time : null;
    if (numericTime == null) {
      updateLegendToLatest();
      return;
    }
    const dataset = store.visibleDatasets[props.timeframe] || [];
    const matched = dataset.find((candle) => candle.time === numericTime);
    if (matched) {
      hoveredCandle.value = matched;
    }
    updateIndicatorLegendValues(numericTime);
  };

  mainChart.subscribeCrosshairMove((param: MouseEventParams) => {
    if (paneChart) {
      syncCrosshairPosition(
        paneChart,
        param,
        getPaneCrosshairTarget(param.time)
      );
    }
    if (!candleSeries) return;
    if (!param.time) {
      updateLegendToLatest();
      return;
    }
    const data = param.seriesData.get(candleSeries) as
      | SeriesDataItemTypeMap["Candlestick"]
      | undefined;
    if (data) {
      hoveredCandle.value = { ...data } as Candle;
    } else {
      const dataset = store.visibleDatasets[props.timeframe] || [];
      if (typeof param.time === "number") {
        const fallback = dataset.find((candle) => candle.time === param.time);
        if (fallback) {
          hoveredCandle.value = fallback;
        }
      }
    }
    handleHoverAtTime(param.time);
  });

  paneChart?.subscribeCrosshairMove((param: MouseEventParams) => {
    if (mainChart) {
      syncCrosshairPosition(
        mainChart,
        param,
        getMainCrosshairTarget(param.time)
      );
    }
    if (!param.time) {
      updateLegendToLatest();
      return;
    }
    handleHoverAtTime(param.time);
  });

  if (Object.keys(store.datasets).length === 0) {
    await store.loadData();
  }

  initChartData();
  initIndicatorData();
  updateTradeMarkers();
  updatePendingOrderLines();

  const mainTimeScale = mainChart.timeScale();
  const handleMainRangeChange = (range: LogicalRange | null) => {
    if (!range || isSyncingRange) return;
    scheduleRangeSync("main", range);
  };
  mainTimeScale.subscribeVisibleLogicalRangeChange(handleMainRangeChange);
  unsubscribeMainRange = () =>
    mainTimeScale.unsubscribeVisibleLogicalRangeChange(handleMainRangeChange);

  if (paneChart) {
    const paneTimeScale = paneChart.timeScale();
    const handlePaneRangeChange = (range: LogicalRange | null) => {
      if (!range || isSyncingRange) return;
      scheduleRangeSync("pane", range);
    };
    paneTimeScale.subscribeVisibleLogicalRangeChange(handlePaneRangeChange);
    unsubscribePaneRange = () =>
      paneTimeScale.unsubscribeVisibleLogicalRangeChange(handlePaneRangeChange);
  }

  paneResizeObserver = new ResizeObserver(() => {
    recomputePaneHeights();
    resizeCharts();
  });
  if (paneRoot.value && paneResizeObserver) {
    paneResizeObserver.observe(paneRoot.value);
  }

  window.addEventListener("resize", handleResize);
  window.addEventListener("keydown", handleHotkeys);
});

function isPaneIndicator(definition: IndicatorDefinition) {
  if (definition.overlay === false) {
    return true;
  }
  // ATR/ADX/RSI style oscillators should live in the dedicated indicator pane
  return PANE_INDICATOR_TYPES.has(definition.type);
}

function toTimestamp(time: Time | undefined) {
  return typeof time === "number" ? time : null;
}

function findLatestItemAtTime<T extends { time: number }>(
  items: T[],
  targetTime: number
) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item && item.time <= targetTime) {
      return item;
    }
  }
  return null;
}

function getMainCrosshairTarget(
  time: Time | undefined
): CrosshairTarget | null {
  if (!candleSeries) return null;
  const timestamp = toTimestamp(time);
  if (timestamp === null) return null;
  const dataset = store.visibleDatasets[props.timeframe] || [];
  const candle = findLatestItemAtTime(dataset, timestamp);
  if (!candle) return null;
  const price = candle.close ?? candle.open ?? candle.high ?? candle.low;
  if (price == null) return null;
  return { series: candleSeries, price };
}

function getPaneCrosshairTarget(
  time: Time | undefined
): CrosshairTarget | null {
  const timestamp = toTimestamp(time);
  if (timestamp === null) return null;
  const indicatorMap = store.visibleIndicators[props.timeframe] || {};
  for (const indicator of store.activeIndicatorDefinitions) {
    if (!isPaneIndicator(indicator)) continue;
    const series = paneIndicatorSeries[indicator.id];
    if (!series) continue;
    const points = indicatorMap[indicator.id] || [];
    const point = findLatestItemAtTime(points, timestamp);
    if (!point) continue;
    return { series, price: point.value };
  }
  return null;
}

function syncCrosshairPosition(
  targetChart: IChartApi | null,
  param: MouseEventParams,
  target: CrosshairTarget | null
) {
  if (!targetChart) return;
  if (param.time === undefined || !target || !Number.isFinite(target.price)) {
    targetChart.clearCrosshairPosition();
    return;
  }
  targetChart.setCrosshairPosition(target.price, param.time, target.series);
}

function setMainRange(range: LogicalRange) {
  if (!mainChart) return;
  isSyncingRange = true;
  mainChart.timeScale().setVisibleLogicalRange(range);
  isSyncingRange = false;
}

function setPaneRange(range: LogicalRange) {
  if (!paneChart) return;
  isSyncingRange = true;
  paneChart.timeScale().setVisibleLogicalRange(range);
  isSyncingRange = false;
}

function scheduleRangeSync(source: "main" | "pane", range: LogicalRange) {
  pendingRange = { ...range };
  rangeSyncSource = source;
  if (source === "main") {
    const span = Math.round(range.to - range.from);
    if (span > 0) {
      preferredRangeSpan.value = span;
    }
  }

  if (rangeSyncFrame !== null) return;

  rangeSyncFrame = requestAnimationFrame(() => {
    if (pendingRange) {
      savedRanges.value[props.timeframe] = { ...pendingRange };
      if (rangeSyncSource === "main") {
        setPaneRange(pendingRange);
      } else {
        setMainRange(pendingRange);
      }
    }
    pendingRange = null;
    rangeSyncSource = null;
    if (rangeSyncFrame !== null) {
      cancelAnimationFrame(rangeSyncFrame);
      rangeSyncFrame = null;
    }
  });
}

function recomputePaneHeights() {
  if (!paneRoot.value) return;
  const totalHeight = paneRoot.value.clientHeight;
  if (!hasPaneIndicators.value) {
    mainPaneHeight.value = totalHeight;
    paneHeight.value = 0;
    return;
  }
  const chartSpace = Math.max(totalHeight - HANDLE_HEIGHT, 0);
  mainPaneHeight.value = chartSpace * mainPaneRatio.value;
  paneHeight.value = chartSpace * (1 - mainPaneRatio.value);
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
    captureDefaultRange();
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
  return isPaneIndicator(indicator)
    ? paneIndicatorSeries[indicator.id]
    : overlayIndicatorSeries[indicator.id];
}

function getSeriesById(id: string) {
  return overlayIndicatorSeries[id] ?? paneIndicatorSeries[id];
}

function saveCurrentRange(timeframe: string) {
  if (!mainChart) return;
  const range = mainChart.timeScale().getVisibleLogicalRange();
  if (range) {
    savedRanges.value[timeframe] = { ...range };
    const span = Math.round(range.to - range.from);
    if (span > 0) {
      preferredRangeSpan.value = span;
    }
  }
}

function getClosestIndex(dataset: Candle[], targetTime: number) {
  if (dataset.length === 0) return 0;
  let left = 0;
  let right = dataset.length - 1;
  let closest = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = dataset[mid]?.time ?? 0;
    const closestTime = dataset[closest]?.time ?? 0;
    if (Math.abs(midTime - targetTime) < Math.abs(closestTime - targetTime)) {
      closest = mid;
    }
    if (midTime === targetTime) {
      return mid;
    }
    if (midTime < targetTime) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return closest;
}

function applyPreferredRange() {
  if (!mainChart) return false;
  const dataset = store.visibleDatasets[props.timeframe] || [];
  if (dataset.length === 0) return false;
  const defaultCount = getDefaultCandleCount(props.timeframe, dataset.length);
  const span =
    preferredRangeSpan.value ?? Math.max(1, defaultCount - 1);
  const rightOffset = mainChart.timeScale().options().rightOffset ?? 0;
  const anchorIndex = getClosestIndex(dataset, store.currentReplayTime);
  const to = Math.max(0, anchorIndex + rightOffset);
  const from = Math.max(0, to - span);
  const range: LogicalRange = { from, to };

  setMainRange(range);
  setPaneRange(range);
  savedRanges.value[props.timeframe] = { ...range };
  defaultRanges.value[props.timeframe] = { ...range };
  return true;
}

function applySavedRangeOrFit() {
  if (!mainChart) return;
  const range = savedRanges.value[props.timeframe];
  if (range) {
    setMainRange(range);
    setPaneRange(range);
    captureDefaultRange();
  } else {
    if (!applyPreferredRange()) {
      mainChart.timeScale().fitContent();
      const fittedRange = mainChart.timeScale().getVisibleLogicalRange();
      if (fittedRange) {
        setPaneRange(fittedRange);
        savedRanges.value[props.timeframe] = { ...fittedRange };
        captureDefaultRange(true);
      }
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
      captureDefaultRange(true);
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
  },
  { deep: true }
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
  recomputePaneHeights();
  resizeCharts();
});
watch(hasPaneIndicators, () => {
  recomputePaneHeights();
  resizeCharts();
});

watch(
  () =>
    store.indicatorDefinitions.map((definition) => ({
      id: definition.id,
      color: definition.color,
      lineWidth: definition.lineWidth,
    })),
  (updatedDefinitions) => {
    for (const definition of updatedDefinitions) {
      const series = getSeriesById(definition.id);
      if (!series) continue;
      series.applyOptions({
        color: definition.color,
        lineWidth: (definition.lineWidth ?? 2) as LineWidth,
      });
    }
  },
  { deep: true }
);

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
  if (unsubscribePaneRange) {
    unsubscribePaneRange();
    unsubscribePaneRange = null;
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
  if (paneChart) {
    paneChart.remove();
  }
  if (rangeSyncFrame !== null) {
    cancelAnimationFrame(rangeSyncFrame);
    rangeSyncFrame = null;
  }
  if (snapshotStatusTimeout) {
    clearTimeout(snapshotStatusTimeout);
    snapshotStatusTimeout = null;
  }
  drawingChart.value = null;
  drawingSeries.value = null;
  paneReferenceSeries.value = null;
  clickHandler = null;
  window.removeEventListener("keydown", handleHotkeys);
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
  if (paneChart && paneChartContainer.value) {
    paneChart.applyOptions({
      width: paneChartContainer.value.clientWidth,
      height: paneChartContainer.value.clientHeight,
    });
  }
}

function updateIndicatorLegendValues(targetTime?: number) {
  const indicatorMap = store.visibleIndicators[props.timeframe] || {};
  const activeIndicators = store.indicatorDefinitions.filter((definition) =>
    store.isIndicatorActive(definition.id)
  );

  const overlayValues: Array<{
    label: string;
    value: number | null;
    color: string;
  }> = [];
  const paneValues: Array<{
    label: string;
    value: number | null;
    color: string;
  }> = [];

  for (const definition of activeIndicators) {
    const points = indicatorMap[definition.id] || [];
    const latestPoint = targetTime
      ? [...points].reverse().find((point) => point.time <= targetTime)
      : points[points.length - 1];
    const entry = {
      label: definition.label,
      value: latestPoint?.value ?? null,
      color: definition.color,
    };
    if (isPaneIndicator(definition)) {
      paneValues.push(entry);
    } else {
      overlayValues.push(entry);
    }
  }

  legendIndicators.value = overlayValues;
  paneLegendIndicators.value = paneValues;
}

function updateTradeMarkers() {
  if (!tradeMarkersPrimitive) return;
  const markers = [
    ...tradingStore.tradeMarkers.map((marker) => ({
      time: marker.time,
      position: marker.position,
      shape: marker.shape,
      color: marker.color,
      text: marker.text,
    })),
  ];
  tradeMarkersPrimitive.setMarkers(markers);
}

function updatePendingOrderLines() {
  if (!candleSeries) return;
  const activeOrders = tradingStore.pendingOrders;
  const existingIds = new Set(
    Object.keys(orderPriceLines).map((id) => Number(id))
  );

  for (const order of activeOrders) {
    const color = order.side === "long" ? "#26a69a" : "#ef5350";
    const label = `${
      order.side === "long" ? "Buy" : "Sell"
    } ${order.orderType.toUpperCase()}`;
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

function captureDefaultRange(force = false) {
  if (!mainChart) return;
  if (!force && defaultRanges.value[props.timeframe]) return;
  const currentRange = mainChart.timeScale().getVisibleLogicalRange();
  if (currentRange) {
    defaultRanges.value[props.timeframe] = { ...currentRange };
  }
}

function resetViewToDefault() {
  if (!mainChart) return;
  const dataset = store.visibleDatasets[props.timeframe] || [];
  if (dataset.length === 0) {
    mainChart.timeScale().fitContent();
    return;
  }

  const lastIndex = Math.max(0, dataset.length - 1);
  const rightOffset = mainChart.timeScale().options().rightOffset ?? 0;
  const to = Math.max(0, lastIndex + rightOffset);
  const defaultCount = getDefaultCandleCount(props.timeframe, dataset.length);
  const from = Math.max(0, to - (defaultCount - 1));
  const snapshotRange: LogicalRange = { from, to };

  setMainRange(snapshotRange);
  setPaneRange(snapshotRange);
  savedRanges.value[props.timeframe] = { ...snapshotRange };
  defaultRanges.value[props.timeframe] = { ...snapshotRange };
}

function getDefaultCandleCount(timeframe: string, datasetLength: number) {
  const limits = TIMEFRAME_DEFAULT_RANGE[timeframe as keyof typeof TIMEFRAME_DEFAULT_RANGE];
  if (!limits) return SNAPSHOT_CANDLE_COUNT;
  const capped = datasetLength > 0 ? Math.min(limits.max, datasetLength) : limits.max;
  return Math.max(limits.min, capped);
}

function handleHotkeys(event: KeyboardEvent) {
  if (event.altKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    resetViewToDefault();
    return;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "s"
  ) {
    event.preventDefault();
    copySnapshotToClipboard();
  }
}

async function copySnapshotToClipboard() {
  if (!mainChart || snapshotStatus.value === "copying") return;
  snapshotStatus.value = "copying";
  snapshotError.value = "";

  try {
    const panes: HTMLCanvasElement[] = [mainChart.takeScreenshot(true, true)];
    if (paneChart) {
      panes.push(paneChart.takeScreenshot(true, true));
    }
    const composite = document.createElement("canvas");
    composite.width = Math.max(...panes.map((pane) => pane.width));
    composite.height = panes.reduce((total, pane) => total + pane.height, 0);
    const context = composite.getContext("2d");
    if (!context) {
      throw new Error("Unable to prepare snapshot canvas");
    }
    let offsetY = 0;
    for (const pane of panes) {
      context.drawImage(pane, 0, offsetY);
      offsetY += pane.height;
    }
    const timeframeLabel = `Timeframe: ${props.timeframe}`;
    const labelPaddingX = 12;
    const labelPaddingY = 8;
    const labelX = 12;
    const labelY = 12;
    const labelFontSize = 18;
    context.save();
    context.font = `600 ${labelFontSize}px sans-serif`;
    context.textBaseline = "top";
    const labelMetrics = context.measureText(timeframeLabel);
    const labelWidth = Math.ceil(labelMetrics.width) + labelPaddingX * 2;
    const labelHeight = labelFontSize + labelPaddingY * 2;
    context.fillStyle = "rgba(5, 5, 5, 0.85)";
    context.fillRect(labelX, labelY, labelWidth, labelHeight);
    context.strokeStyle = "rgba(59, 130, 246, 0.7)";
    context.lineWidth = 1;
    context.strokeRect(labelX, labelY, labelWidth, labelHeight);
    context.fillStyle = "#e2e8f0";
    context.fillText(
      timeframeLabel,
      labelX + labelPaddingX,
      labelY + labelPaddingY
    );
    context.restore();

    const blob = await new Promise<Blob>((resolve, reject) => {
      composite.toBlob((created) => {
        if (created) {
          resolve(created);
        } else {
          reject(new Error("Failed to create snapshot blob"));
        }
      }, "image/png");
    });

    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    snapshotStatus.value = "copied";
  } catch (error) {
    console.error("Failed to copy snapshot", error);
    snapshotStatus.value = "error";
    snapshotError.value = "Snapshot failed. Please try again.";
  } finally {
    if (snapshotStatusTimeout) {
      clearTimeout(snapshotStatusTimeout);
    }
    snapshotStatusTimeout = window.setTimeout(() => {
      snapshotStatus.value = "idle";
      snapshotError.value = "";
    }, 2200);
  }
}
</script>

<template>
  <div
    ref="paneRoot"
    class="relative w-full h-full bg-[#050505] overflow-hidden border-r border-gray-800"
    :class="
      store.isSelectingReplay ? 'cursor-crosshair ring-1 ring-blue-500/50' : ''
    "
  >
    <div
      v-if="store.isSelectingReplay"
      class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
    >
      <div
        class="px-3 py-2 bg-blue-600/90 text-xs font-semibold rounded shadow-lg"
      >
        Click a candle to start replay
      </div>
    </div>

    <ChartLegend
      :candle="hoveredCandle"
      :symbol="store.activeSymbol"
      :interval="timeframe"
      :indicators="legendIndicators"
    />
    <DrawingManager
      :symbol="store.activeSymbol"
      :timeframe="timeframe"
      :dataset="activeDatasetForTimeframe"
      :main-chart="drawingChart"
      :main-series="drawingSeries"
      :main-container="mainChartContainer"
      :pane-chart="paneChart"
      :pane-series="paneReferenceSeries"
      :pane-container="paneChartContainer"
    />

    <div class="absolute inset-0 flex flex-col">
      <div
        class="absolute right-4 top-4 z-20 flex flex-col items-end gap-2 pointer-events-none"
      >
        <div class="flex gap-2 pointer-events-auto">
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-semibold rounded border border-gray-700 bg-[#050505]/80 text-gray-100 hover:border-blue-500 hover:text-blue-100 transition"
            title="Reset chart view (Alt + R)"
            @click="resetViewToDefault"
          >
            Reset View
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-semibold rounded border border-gray-700 bg-[#050505]/80 text-gray-100 hover:border-blue-500 hover:text-blue-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="snapshotStatus === 'copying'"
            title="Copy snapshot to clipboard (Ctrl/Cmd + Shift + S)"
            @click="copySnapshotToClipboard"
          >
            {{ snapshotStatus === "copying" ? "Copying..." : "Snapshot" }}
          </button>
        </div>
        <div
          v-if="snapshotStatus === 'copied' || snapshotStatus === 'error'"
          class="px-2 py-1 text-[11px] rounded bg-[#050505]/90 border"
          :class="
            snapshotStatus === 'copied'
              ? 'border-green-500 text-green-100'
              : 'border-red-500 text-red-100'
          "
        >
          {{
            snapshotStatus === "copied"
              ? "Snapshot copied to clipboard"
              : snapshotError
          }}
        </div>
      </div>

      <div
        class="relative w-full"
        :style="{ height: `${mainPaneHeight}px`, minHeight: '160px' }"
      >
        <div ref="mainChartContainer" class="w-full h-full"></div>
      </div>

      <template v-if="hasPaneIndicators">
        <div
          class="h-2 bg-gray-800/80 hover:bg-gray-700/80 flex items-center justify-center cursor-row-resize select-none"
          @mousedown="beginPaneResize"
        >
          <svg
            class="w-4 h-1 text-gray-500"
            viewBox="0 0 16 4"
            fill="currentColor"
          >
            <circle cx="2" cy="2" r="1" />
            <circle cx="8" cy="2" r="1" />
            <circle cx="14" cy="2" r="1" />
          </svg>
        </div>

        <div
          class="relative w-full"
          :style="{ height: `${paneHeight}px`, minHeight: '120px' }"
        >
          <div ref="paneChartContainer" class="w-full h-full"></div>
          <div
            v-if="paneLegendIndicators.length"
            class="absolute left-3 bottom-3 z-10 pointer-events-none bg-[#050505]/80 border border-gray-700 rounded px-3 py-2 text-[11px] font-mono text-gray-200 backdrop-blur-sm shadow-lg"
          >
            <div class="flex flex-wrap gap-3">
              <div
                v-for="indicator in paneLegendIndicators"
                :key="indicator.label"
                class="flex items-center gap-2"
              >
                <span class="font-semibold" :style="{ color: indicator.color }">
                  {{ indicator.label }}
                </span>
                <span class="text-white">{{
                  indicator.value == null ? "--" : indicator.value.toFixed(2)
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
