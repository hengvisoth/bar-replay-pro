<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  computed,
  shallowRef,
} from "vue";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
  LineSeries,
  type MouseEventParams,
  type Logical,
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
import {
  useUiStore,
  type DrawingPoint,
  type TrendLineDrawing,
  type RectangleDrawing,
} from "../stores/uiStore";
import { INDICATOR_IDS } from "../indicators/indicatorIds";
import { computeTrendFollowingAlertMarkers } from "../indicators/TrendFollowingAlertsIndicator";
import ChartLegend from "./ChartLegend.vue";
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
type ProjectedTrendLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  lineWidth: number;
  dashed: boolean;
};
type ProjectedRectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  lineWidth: number;
  fill: string;
  dashed: boolean;
  label: string;
};
type RectangleResizeHandle =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";
type RectangleInteractionState = {
  rectangleId: string;
  mode: "move" | "resize";
  handle: RectangleResizeHandle | null;
  origin: ProjectedRectangle;
  startClientX: number;
  startClientY: number;
};

const props = defineProps<{
  timeframe: string;
}>();

const store = useReplayStore();
const tradingStore = useTradingStore();
const uiStore = useUiStore();

const paneRoot = ref<HTMLElement | null>(null);
const mainPaneSurface = ref<HTMLElement | null>(null);
const mainChartContainer = ref<HTMLElement | null>(null);
const paneChartContainer = ref<HTMLElement | null>(null);
const rectangleLabelInput = ref<HTMLInputElement | null>(null);
const paneReferenceSeries = shallowRef<ISeriesApi<"Line"> | null>(null);
const mainPaneRatio = ref(0.7);
const mainPaneHeight = ref(0);
const paneHeight = ref(0);
const shouldCenterOnTimeframeChange = ref(false);

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
const drawingStartPoint = ref<DrawingPoint | null>(null);
const drawingPreviewPoint = ref<DrawingPoint | null>(null);
const drawingRefreshTick = ref(0);
const selectedRectangleId = ref<string | null>(null);
const editingRectangleId = ref<string | null>(null);
const rectangleLabelDraft = ref("");

let mainChart: IChartApi | null = null;
let paneChart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let overlayIndicatorSeries: Record<string, ISeriesApi<"Line">> = {};
let paneIndicatorSeries: Record<string, ISeriesApi<"Line">> = {};
let unsubscribeMainRange: (() => void) | null = null;
let unsubscribePaneRange: (() => void) | null = null;
let isSyncingRange = false;
let tradeMarkersPrimitive: ISeriesMarkersPluginApi<Time> | null = null;
let trendAlertMarkersPrimitive: ISeriesMarkersPluginApi<Time> | null = null;
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
let rectangleInteractionState: RectangleInteractionState | null = null;

const hasPaneIndicators = computed(() =>
  store.activeIndicatorDefinitions.some(
    (def) => isPaneIndicator(def) && store.isIndicatorActive(def.id),
  ),
);
const currentTrendLines = computed(() =>
  uiStore.getTrendLines(store.activeSymbol, props.timeframe),
);
const currentRectangles = computed(() =>
  uiStore.getRectangles(store.activeSymbol, props.timeframe),
);
const projectedTrendLines = computed<ProjectedTrendLine[]>(() => {
  drawingRefreshTick.value;
  const projected: ProjectedTrendLine[] = [];
  for (const line of currentTrendLines.value) {
    const item = projectTrendLine(line, false);
    if (item) {
      projected.push(item);
    }
  }
  if (drawingStartPoint.value && drawingPreviewPoint.value) {
    const preview = projectTrendLine(
      {
        id: "trendline-preview",
        symbol: store.activeSymbol,
        timeframe: props.timeframe,
        start: drawingStartPoint.value,
        end: drawingPreviewPoint.value,
        color: "#94a3b8",
        lineWidth: 1,
      },
      true,
    );
    if (preview) {
      projected.push(preview);
    }
  }
  return projected;
});
const projectedRectangles = computed<ProjectedRectangle[]>(() => {
  drawingRefreshTick.value;
  const projected: ProjectedRectangle[] = [];
  for (const rect of currentRectangles.value) {
    const item = projectRectangle(rect, false);
    if (item) {
      projected.push(item);
    }
  }
  if (drawingStartPoint.value && drawingPreviewPoint.value) {
    const preview = projectRectangle(
      {
        id: "rectangle-preview",
        symbol: store.activeSymbol,
        timeframe: props.timeframe,
        start: drawingStartPoint.value,
        end: drawingPreviewPoint.value,
        color: "#94a3b8",
        lineWidth: 1,
        fillOpacity: 0.08,
        label: "",
      },
      true,
    );
    if (preview) {
      projected.push(preview);
    }
  }
  return projected;
});
const projectedRectanglesById = computed(() => {
  const map = new Map<string, ProjectedRectangle>();
  for (const rectangle of projectedRectangles.value) {
    map.set(rectangle.id, rectangle);
  }
  return map;
});
const selectedProjectedRectangle = computed(() => {
  if (!selectedRectangleId.value) return null;
  return projectedRectanglesById.value.get(selectedRectangleId.value) ?? null;
});
const labelEditorStyle = computed(() => {
  const rect = selectedProjectedRectangle.value;
  if (!rect) return null;
  const top = Math.max(8, rect.y - 40);
  const maxLeft = Math.max(8, rect.x + rect.width - 176);
  const left = Math.min(Math.max(8, rect.x), maxLeft);
  return {
    left: `${left}px`,
    top: `${top}px`,
  };
});
onMounted(async () => {
  await nextTick();
  recomputePaneHeights();
  if (!mainChartContainer.value) return;

  mainChart = createChart(mainChartContainer.value, {
    layout: { background: { color: "#050505" }, textColor: "#d1d4dc" },
    grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
    width: mainChartContainer.value.clientWidth,
    height: mainChartContainer.value.clientHeight,
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5 },
    crosshair: { mode: 0 },
  });

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
      crosshair: { mode: 0 },
    });
  }

  candleSeries = mainChart.addSeries(CandlestickSeries, {
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
  });
  tradeMarkersPrimitive = createSeriesMarkers(candleSeries, []);
  trendAlertMarkersPrimitive = createSeriesMarkers(candleSeries, []);

  overlayIndicatorSeries = {};
  paneIndicatorSeries = {};
  for (const indicator of store.indicatorDefinitions) {
    if (isMarkerOnlyIndicator(indicator)) continue;
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
    if (store.isSelectingReplay) {
      if (typeof param.time === "number") {
        store.setReplayStart(param.time);
      }
      return;
    }
    if (uiStore.drawingTool !== "cursor") {
      handleDrawingClick(param);
      return;
    }
    if (selectedRectangleId.value || editingRectangleId.value) {
      selectedRectangleId.value = null;
      editingRectangleId.value = null;
      rectangleLabelDraft.value = "";
      refreshDrawingOverlay();
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
    if (uiStore.drawingTool !== "cursor") {
      updateDrawingPreview(param);
    }
    if (paneChart) {
      syncCrosshairPosition(
        paneChart,
        param,
        getPaneCrosshairTarget(param.time),
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
        getMainCrosshairTarget(param.time),
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
  updateTrendAlertMarkers();
  updatePendingOrderLines();

  const mainTimeScale = mainChart.timeScale();
  const handleMainRangeChange = (range: LogicalRange | null) => {
    refreshDrawingOverlay();
    if (!range || isSyncingRange) return;
    scheduleRangeSync("main", range);
  };
  mainTimeScale.subscribeVisibleLogicalRangeChange(handleMainRangeChange);
  unsubscribeMainRange = () =>
    mainTimeScale.unsubscribeVisibleLogicalRangeChange(handleMainRangeChange);

  if (paneChart) {
    const paneTimeScale = paneChart.timeScale();
    const handlePaneRangeChange = (range: LogicalRange | null) => {
      refreshDrawingOverlay();
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
  refreshDrawingOverlay();
});

function isPaneIndicator(definition: IndicatorDefinition) {
  if (definition.overlay === false) {
    return true;
  }
  // ATR/ADX/RSI style oscillators should live in the dedicated indicator pane
  return PANE_INDICATOR_TYPES.has(definition.type);
}

function isMarkerOnlyIndicator(definition: IndicatorDefinition) {
  return definition.type === "trendAlerts";
}

function toTimestamp(time: Time | undefined) {
  return typeof time === "number" ? time : null;
}

function toLogical(value: number): Logical {
  return value as Logical;
}

function findLatestItemAtTime<T extends { time: number }>(
  items: T[],
  targetTime: number,
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
  time: Time | undefined,
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
  time: Time | undefined,
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
  target: CrosshairTarget | null,
) {
  if (!targetChart) return;
  if (param.time === undefined || !target || !Number.isFinite(target.price)) {
    targetChart.clearCrosshairPosition();
    return;
  }
  targetChart.setCrosshairPosition(target.price, param.time, target.series);
}

function toDrawingPoint(param: MouseEventParams): DrawingPoint | null {
  if (!candleSeries || !param.point || typeof param.time !== "number") {
    return null;
  }
  const price = candleSeries.coordinateToPrice(param.point.y);
  if (price == null || !Number.isFinite(price)) {
    return null;
  }
  return { time: param.time, price };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getMainPaneLimits() {
  if (!mainPaneSurface.value) return null;
  return {
    maxX: Math.max(mainPaneSurface.value.clientWidth - 1, 0),
    maxY: Math.max(mainPaneSurface.value.clientHeight - 1, 0),
  };
}

function toDrawingPointFromCoordinates(
  x: number,
  y: number,
): DrawingPoint | null {
  if (!mainChart || !candleSeries) return null;
  const limits = getMainPaneLimits();
  if (!limits) return null;

  const normalizedX = clamp(x, 0, limits.maxX);
  const normalizedY = clamp(y, 0, limits.maxY);
  const time = mainChart.timeScale().coordinateToTime(normalizedX);
  if (typeof time !== "number") {
    return null;
  }
  const price = candleSeries.coordinateToPrice(normalizedY);
  if (price == null || !Number.isFinite(price)) {
    return null;
  }
  return { time, price };
}

function beginRectangleLabelEdit(rectangleId: string) {
  const rectangle = currentRectangles.value.find((item) => item.id === rectangleId);
  if (!rectangle) return;
  selectedRectangleId.value = rectangleId;
  editingRectangleId.value = rectangleId;
  rectangleLabelDraft.value = rectangle.label;
  nextTick(() => {
    rectangleLabelInput.value?.focus();
    rectangleLabelInput.value?.select();
  });
}

function saveRectangleLabel() {
  if (!editingRectangleId.value) return;
  uiStore.updateRectangle(editingRectangleId.value, {
    label: rectangleLabelDraft.value.trim(),
  });
  editingRectangleId.value = null;
  refreshDrawingOverlay();
}

function cancelRectangleLabelEdit() {
  if (!editingRectangleId.value) return;
  editingRectangleId.value = null;
  rectangleLabelDraft.value = "";
}

function handleRectangleLabelKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    saveRectangleLabel();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelRectangleLabelEdit();
  }
}

function updateRectangleFromProjectedBounds(
  rectangleId: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const start = toDrawingPointFromCoordinates(left, top);
  const end = toDrawingPointFromCoordinates(right, bottom);
  if (!start || !end) return;
  uiStore.updateRectangle(rectangleId, { start, end });
  refreshDrawingOverlay();
}

function beginRectangleInteraction(
  rectangleId: string,
  mode: "move" | "resize",
  handle: RectangleResizeHandle | null,
  event: MouseEvent,
) {
  if (uiStore.drawingTool !== "cursor") return;
  const projected = projectedRectanglesById.value.get(rectangleId);
  if (!projected || projected.id === "rectangle-preview") return;
  selectedRectangleId.value = rectangleId;
  rectangleInteractionState = {
    rectangleId,
    mode,
    handle,
    origin: { ...projected },
    startClientX: event.clientX,
    startClientY: event.clientY,
  };
  document.addEventListener("mousemove", handleRectangleInteractionMove);
  document.addEventListener("mouseup", endRectangleInteraction);
  event.preventDefault();
  event.stopPropagation();
}

function beginRectangleMove(rectangleId: string, event: MouseEvent) {
  beginRectangleInteraction(rectangleId, "move", null, event);
}

function beginRectangleResize(
  rectangleId: string,
  handle: RectangleResizeHandle,
  event: MouseEvent,
) {
  beginRectangleInteraction(rectangleId, "resize", handle, event);
}

function handleRectangleInteractionMove(event: MouseEvent) {
  if (!rectangleInteractionState) return;
  const limits = getMainPaneLimits();
  if (!limits) return;
  const state = rectangleInteractionState;
  const deltaX = event.clientX - state.startClientX;
  const deltaY = event.clientY - state.startClientY;
  const minimumSize = 6;

  let left = state.origin.x;
  let right = state.origin.x + state.origin.width;
  let top = state.origin.y;
  let bottom = state.origin.y + state.origin.height;

  if (state.mode === "move") {
    left += deltaX;
    right += deltaX;
    top += deltaY;
    bottom += deltaY;

    if (left < 0) {
      right -= left;
      left = 0;
    }
    if (right > limits.maxX) {
      const overflow = right - limits.maxX;
      left -= overflow;
      right = limits.maxX;
    }
    if (top < 0) {
      bottom -= top;
      top = 0;
    }
    if (bottom > limits.maxY) {
      const overflow = bottom - limits.maxY;
      top -= overflow;
      bottom = limits.maxY;
    }
  } else if (state.handle) {
    if (state.handle.includes("w")) {
      left += deltaX;
    }
    if (state.handle.includes("e")) {
      right += deltaX;
    }
    if (state.handle.includes("n")) {
      top += deltaY;
    }
    if (state.handle.includes("s")) {
      bottom += deltaY;
    }

    left = clamp(left, 0, limits.maxX);
    right = clamp(right, 0, limits.maxX);
    top = clamp(top, 0, limits.maxY);
    bottom = clamp(bottom, 0, limits.maxY);

    if (right - left < minimumSize) {
      if (state.handle.includes("w")) {
        left = right - minimumSize;
      } else {
        right = left + minimumSize;
      }
    }
    if (bottom - top < minimumSize) {
      if (state.handle.includes("n")) {
        top = bottom - minimumSize;
      } else {
        bottom = top + minimumSize;
      }
    }

    left = clamp(left, 0, limits.maxX);
    right = clamp(right, 0, limits.maxX);
    top = clamp(top, 0, limits.maxY);
    bottom = clamp(bottom, 0, limits.maxY);
  }

  updateRectangleFromProjectedBounds(
    state.rectangleId,
    Math.min(left, right),
    Math.min(top, bottom),
    Math.max(left, right),
    Math.max(top, bottom),
  );
  event.preventDefault();
}

function endRectangleInteraction() {
  if (!rectangleInteractionState) return;
  rectangleInteractionState = null;
  document.removeEventListener("mousemove", handleRectangleInteractionMove);
  document.removeEventListener("mouseup", endRectangleInteraction);
}

function handleDrawingClick(param: MouseEventParams) {
  const point = toDrawingPoint(param);
  if (!point) return;

  if (!drawingStartPoint.value) {
    drawingStartPoint.value = point;
    drawingPreviewPoint.value = point;
    refreshDrawingOverlay();
    return;
  }

  if (uiStore.drawingTool === "trendLine") {
    uiStore.addTrendLine({
      symbol: store.activeSymbol,
      timeframe: props.timeframe,
      start: drawingStartPoint.value,
      end: point,
    });
  } else if (uiStore.drawingTool === "rectangle") {
    const rectangleId = uiStore.addRectangle({
      symbol: store.activeSymbol,
      timeframe: props.timeframe,
      start: drawingStartPoint.value,
      end: point,
    });
    uiStore.setDrawingTool("cursor");
    beginRectangleLabelEdit(rectangleId);
  }
  drawingStartPoint.value = null;
  drawingPreviewPoint.value = null;
  refreshDrawingOverlay();
}

function updateDrawingPreview(param: MouseEventParams) {
  if (!drawingStartPoint.value) return;
  const point = toDrawingPoint(param);
  drawingPreviewPoint.value = point;
  refreshDrawingOverlay();
}

function cancelDrawingDraft() {
  if (!drawingStartPoint.value && !drawingPreviewPoint.value) return;
  drawingStartPoint.value = null;
  drawingPreviewPoint.value = null;
  refreshDrawingOverlay();
}

function refreshDrawingOverlay() {
  drawingRefreshTick.value += 1;
}

function projectTrendLine(
  line: TrendLineDrawing,
  dashed: boolean,
): ProjectedTrendLine | null {
  if (!mainChart || !candleSeries) return null;
  const timeScale = mainChart.timeScale();
  const x1 = timeScale.timeToCoordinate(line.start.time as Time);
  const y1 = candleSeries.priceToCoordinate(line.start.price);
  const x2 = timeScale.timeToCoordinate(line.end.time as Time);
  const y2 = candleSeries.priceToCoordinate(line.end.price);
  if (
    x1 == null ||
    y1 == null ||
    x2 == null ||
    y2 == null ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    return null;
  }
  return {
    id: line.id,
    x1,
    y1,
    x2,
    y2,
    color: line.color,
    lineWidth: line.lineWidth,
    dashed,
  };
}

function projectRectangle(
  rectangle: RectangleDrawing,
  dashed: boolean,
): ProjectedRectangle | null {
  if (!mainChart || !candleSeries) return null;
  const timeScale = mainChart.timeScale();
  const x1 = timeScale.timeToCoordinate(rectangle.start.time as Time);
  const y1 = candleSeries.priceToCoordinate(rectangle.start.price);
  const x2 = timeScale.timeToCoordinate(rectangle.end.time as Time);
  const y2 = candleSeries.priceToCoordinate(rectangle.end.price);
  if (
    x1 == null ||
    y1 == null ||
    x2 == null ||
    y2 == null ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    return null;
  }
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.max(Math.abs(x2 - x1), 1);
  const height = Math.max(Math.abs(y2 - y1), 1);
  const opacity = Math.max(0, Math.min(1, rectangle.fillOpacity));

  return {
    id: rectangle.id,
    x,
    y,
    width,
    height,
    color: rectangle.color,
    lineWidth: rectangle.lineWidth,
    fill: hexToRgba(rectangle.color, opacity),
    dashed,
    label: rectangle.label,
  };
}

function hexToRgba(color: string, alpha: number) {
  const sanitized = color.trim();
  const full = /^#[0-9a-fA-F]{6}$/.test(sanitized)
    ? sanitized
    : /^#[0-9a-fA-F]{3}$/.test(sanitized)
      ? `#${sanitized[1]}${sanitized[1]}${sanitized[2]}${sanitized[2]}${sanitized[3]}${sanitized[3]}`
      : "#38bdf8";
  const r = Number.parseInt(full.slice(1, 3), 16);
  const g = Number.parseInt(full.slice(3, 5), 16);
  const b = Number.parseInt(full.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  if (isMarkerOnlyIndicator(indicator)) return undefined;
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
  const span = preferredRangeSpan.value ?? Math.max(1, defaultCount - 1);
  const rightOffset = mainChart.timeScale().options().rightOffset ?? 0;
  const anchorIndex = getClosestIndex(dataset, store.currentReplayTime);
  const to = Math.max(0, anchorIndex + rightOffset);
  const from = Math.max(0, to - span);
  const range: LogicalRange = { from: toLogical(from), to: toLogical(to) };

  setMainRange(range);
  setPaneRange(range);
  savedRanges.value[props.timeframe] = { ...range };
  defaultRanges.value[props.timeframe] = { ...range };
  return true;
}

function centerRangeOnReplayTime() {
  if (!mainChart) return false;
  const dataset = store.visibleDatasets[props.timeframe] || [];
  if (dataset.length === 0) return false;
  const defaultCount = getDefaultCandleCount(props.timeframe, dataset.length);
  const span = Math.max(
    1,
    Math.round(preferredRangeSpan.value ?? defaultCount - 1),
  );
  const anchorIndex = getClosestIndex(dataset, store.currentReplayTime);
  const half = Math.floor(span / 2);
  let from = anchorIndex - half;
  let to = from + span;
  if (from < 0) {
    from = 0;
    to = span;
  }
  const range: LogicalRange = { from: toLogical(from), to: toLogical(to) };
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

    if (shouldCenterOnTimeframeChange.value && newData.length > 0) {
      if (centerRangeOnReplayTime()) {
        shouldCenterOnTimeframeChange.value = false;
      }
    }
    updateTrendAlertMarkers();
    refreshDrawingOverlay();
  },
);

watch(
  () => props.timeframe,
  (_newTf, oldTf) => {
    if (oldTf) {
      saveCurrentRange(oldTf);
    }
    shouldCenterOnTimeframeChange.value = true;
    initChartData();
    initIndicatorData();
    updateTrendAlertMarkers();
    refreshDrawingOverlay();
  },
  { flush: "sync" },
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
    updateTrendAlertMarkers();
  },
);

watch(
  () => tradingStore.tradeMarkers,
  () => {
    updateTradeMarkers();
  },
);

watch(
  () => tradingStore.pendingOrders,
  () => {
    updatePendingOrderLines();
  },
);

watch(
  () => ({
    enabled:
      store.activeIndicators[INDICATOR_IDS.TREND_FOLLOWING_ALERTS_15M] ?? false,
    color:
      store.indicatorDefinitions.find(
        (definition) =>
          definition.id === INDICATOR_IDS.TREND_FOLLOWING_ALERTS_15M,
      )?.color ?? "",
  }),
  () => {
    updateTrendAlertMarkers();
  },
  { deep: false },
);

watch(
  () => [uiStore.drawingTool, props.timeframe, store.activeSymbol] as const,
  ([nextTool, nextTimeframe, nextSymbol], [, prevTimeframe, prevSymbol]) => {
    cancelDrawingDraft();
    endRectangleInteraction();
    if (nextTimeframe !== prevTimeframe || nextSymbol !== prevSymbol) {
      selectedRectangleId.value = null;
      editingRectangleId.value = null;
      rectangleLabelDraft.value = "";
    } else if (nextTool !== "cursor" && editingRectangleId.value) {
      editingRectangleId.value = null;
      rectangleLabelDraft.value = "";
    }
    refreshDrawingOverlay();
  },
);

watch(
  () => uiStore.trendLines,
  () => {
    refreshDrawingOverlay();
  },
  { deep: true },
);

watch(
  () => uiStore.rectangles,
  () => {
    if (
      selectedRectangleId.value &&
      !currentRectangles.value.some(
        (rectangle) => rectangle.id === selectedRectangleId.value,
      )
    ) {
      selectedRectangleId.value = null;
      editingRectangleId.value = null;
      rectangleLabelDraft.value = "";
    }
    refreshDrawingOverlay();
  },
  { deep: true },
);

watch(mainPaneRatio, () => {
  recomputePaneHeights();
  resizeCharts();
  refreshDrawingOverlay();
});
watch(hasPaneIndicators, () => {
  recomputePaneHeights();
  resizeCharts();
  refreshDrawingOverlay();
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
    updateTrendAlertMarkers();
  },
  { deep: true },
);

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  endPaneResize();
  endRectangleInteraction();
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
  if (trendAlertMarkersPrimitive) {
    trendAlertMarkersPrimitive.setMarkers([]);
    trendAlertMarkersPrimitive = null;
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
  refreshDrawingOverlay();
}

function updateIndicatorLegendValues(targetTime?: number) {
  const indicatorMap = store.visibleIndicators[props.timeframe] || {};
  const activeIndicators = store.indicatorDefinitions.filter((definition) =>
    store.isIndicatorActive(definition.id) && !isMarkerOnlyIndicator(definition),
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

function updateTrendAlertMarkers() {
  if (!trendAlertMarkersPrimitive) return;
  const enabled =
    store.activeIndicators[INDICATOR_IDS.TREND_FOLLOWING_ALERTS_15M] ?? false;
  if (!enabled || props.timeframe !== "15m") {
    trendAlertMarkersPrimitive.setMarkers([]);
    return;
  }

  const lowerData = store.visibleDatasets[props.timeframe] || [];
  if (lowerData.length < 3) {
    trendAlertMarkersPrimitive.setMarkers([]);
    return;
  }

  const htfDataset = getCandlesUpToTime(
    store.datasets["1h"] || [],
    lowerData[lowerData.length - 1]?.time ?? store.currentReplayTime,
  );
  if (htfDataset.length < 3) {
    trendAlertMarkersPrimitive.setMarkers([]);
    return;
  }

  const definition = store.indicatorDefinitions.find(
    (indicator) => indicator.id === INDICATOR_IDS.TREND_FOLLOWING_ALERTS_15M,
  );

  const markers = computeTrendFollowingAlertMarkers(lowerData, htfDataset, {
    longColor: definition?.color ?? "#22c55e",
  });
  trendAlertMarkersPrimitive.setMarkers(markers);
}

function getCandlesUpToTime(dataset: Candle[], timestamp: number) {
  if (dataset.length === 0) return [];
  let left = 0;
  let right = dataset.length - 1;
  let endIndex = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const candleTime = dataset[mid]?.time ?? 0;
    if (candleTime <= timestamp) {
      endIndex = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return endIndex >= 0 ? dataset.slice(0, endIndex + 1) : [];
}

function updatePendingOrderLines() {
  if (!candleSeries) return;
  const activeOrders = tradingStore.pendingOrders;
  const existingIds = new Set(
    Object.keys(orderPriceLines).map((id) => Number(id)),
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
  const snapshotRange: LogicalRange = {
    from: toLogical(from),
    to: toLogical(to),
  };

  setMainRange(snapshotRange);
  setPaneRange(snapshotRange);
  savedRanges.value[props.timeframe] = { ...snapshotRange };
  defaultRanges.value[props.timeframe] = { ...snapshotRange };
}

function getDefaultCandleCount(timeframe: string, datasetLength: number) {
  const limits =
    TIMEFRAME_DEFAULT_RANGE[timeframe as keyof typeof TIMEFRAME_DEFAULT_RANGE];
  if (!limits) return SNAPSHOT_CANDLE_COUNT;
  const capped =
    datasetLength > 0 ? Math.min(limits.max, datasetLength) : limits.max;
  return Math.max(limits.min, capped);
}

function handleHotkeys(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }
  if (event.key === "Escape") {
    if (editingRectangleId.value) {
      event.preventDefault();
      cancelRectangleLabelEdit();
      return;
    }
    if (drawingStartPoint.value) {
      event.preventDefault();
      cancelDrawingDraft();
    }
    return;
  }
  if (
    (event.key === "Backspace" || event.key === "Delete") &&
    uiStore.drawingTool !== "cursor"
  ) {
    event.preventDefault();
    cancelDrawingDraft();
    if (uiStore.drawingTool === "trendLine") {
      uiStore.removeLastTrendLine(store.activeSymbol, props.timeframe);
    } else if (uiStore.drawingTool === "rectangle") {
      uiStore.removeLastRectangle(store.activeSymbol, props.timeframe);
    }
    refreshDrawingOverlay();
    return;
  }
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
      labelY + labelPaddingY,
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
    :class="[
      store.isSelectingReplay ? 'cursor-crosshair ring-1 ring-blue-500/50' : '',
      uiStore.drawingTool !== 'cursor' && !store.isSelectingReplay
        ? 'cursor-crosshair'
        : '',
    ]"
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
    <div
      v-else-if="uiStore.drawingTool !== 'cursor'"
      class="absolute left-3 top-16 z-20 pointer-events-none"
    >
      <div class="px-2 py-1 bg-[#050505]/90 border border-blue-500/50 text-[11px] text-blue-100 rounded">
        {{
          drawingStartPoint
            ? "Click second point to finish drawing"
            : uiStore.drawingTool === "trendLine"
              ? "Trend Line: click first point"
              : "Rectangle: click first corner"
        }}
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
        ref="mainPaneSurface"
        class="relative w-full"
        :style="{ height: `${mainPaneHeight}px`, minHeight: '160px' }"
      >
        <div ref="mainChartContainer" class="w-full h-full"></div>
        <svg class="absolute inset-0 z-10 w-full h-full pointer-events-none">
          <rect
            v-for="rectangle in projectedRectangles"
            :key="rectangle.id"
            :x="rectangle.x"
            :y="rectangle.y"
            :width="rectangle.width"
            :height="rectangle.height"
            :fill="rectangle.fill"
            :stroke="rectangle.color"
            :stroke-width="
              selectedRectangleId === rectangle.id
                ? rectangle.lineWidth + 1
                : rectangle.lineWidth
            "
            :stroke-dasharray="rectangle.dashed ? '6 4' : undefined"
            :class="
              uiStore.drawingTool === 'cursor' && !rectangle.dashed
                ? 'pointer-events-auto cursor-move'
                : ''
            "
            @mousedown="
              (event) =>
                !rectangle.dashed && beginRectangleMove(rectangle.id, event)
            "
            @dblclick="
              !rectangle.dashed && beginRectangleLabelEdit(rectangle.id)
            "
          />
          <template
            v-for="rectangle in projectedRectangles"
            :key="`${rectangle.id}-handles`"
          >
            <g
              v-if="
                uiStore.drawingTool === 'cursor' &&
                selectedRectangleId === rectangle.id &&
                !rectangle.dashed
              "
            >
              <circle
                :cx="rectangle.x"
                :cy="rectangle.y"
                r="4"
                class="pointer-events-auto cursor-nwse-resize fill-blue-500"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 'nw', event)
                "
              />
              <circle
                :cx="rectangle.x + rectangle.width"
                :cy="rectangle.y"
                r="4"
                class="pointer-events-auto cursor-nesw-resize fill-blue-500"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 'ne', event)
                "
              />
              <circle
                :cx="rectangle.x"
                :cy="rectangle.y + rectangle.height"
                r="4"
                class="pointer-events-auto cursor-nesw-resize fill-blue-500"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 'sw', event)
                "
              />
              <circle
                :cx="rectangle.x + rectangle.width"
                :cy="rectangle.y + rectangle.height"
                r="4"
                class="pointer-events-auto cursor-nwse-resize fill-blue-500"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 'se', event)
                "
              />
              <circle
                :cx="rectangle.x + rectangle.width / 2"
                :cy="rectangle.y"
                r="3.5"
                class="pointer-events-auto cursor-ns-resize fill-blue-400"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 'n', event)
                "
              />
              <circle
                :cx="rectangle.x + rectangle.width / 2"
                :cy="rectangle.y + rectangle.height"
                r="3.5"
                class="pointer-events-auto cursor-ns-resize fill-blue-400"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 's', event)
                "
              />
              <circle
                :cx="rectangle.x"
                :cy="rectangle.y + rectangle.height / 2"
                r="3.5"
                class="pointer-events-auto cursor-ew-resize fill-blue-400"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 'w', event)
                "
              />
              <circle
                :cx="rectangle.x + rectangle.width"
                :cy="rectangle.y + rectangle.height / 2"
                r="3.5"
                class="pointer-events-auto cursor-ew-resize fill-blue-400"
                @mousedown="
                  (event) => beginRectangleResize(rectangle.id, 'e', event)
                "
              />
            </g>
          </template>
          <line
            v-for="line in projectedTrendLines"
            :key="line.id"
            :x1="line.x1"
            :y1="line.y1"
            :x2="line.x2"
            :y2="line.y2"
            :stroke="line.color"
            :stroke-width="line.lineWidth"
            :stroke-dasharray="line.dashed ? '6 4' : undefined"
            stroke-linecap="round"
          />
        </svg>
        <div
          v-for="rectangle in projectedRectangles"
          :key="`${rectangle.id}-label`"
          class="absolute z-20 max-w-[180px] pointer-events-none rounded border border-gray-700 bg-[#050505]/90 px-2 py-1 text-[11px] text-gray-200 truncate"
          :class="rectangle.dashed || !rectangle.label ? 'hidden' : ''"
          :style="{
            left: `${Math.max(8, rectangle.x + 8)}px`,
            top: `${Math.max(8, rectangle.y + 8)}px`,
          }"
        >
          {{ rectangle.label }}
        </div>
        <div
          v-if="
            selectedProjectedRectangle &&
            uiStore.drawingTool === 'cursor' &&
            labelEditorStyle
          "
          class="absolute z-30 pointer-events-auto rounded border border-blue-500/60 bg-[#050505]/95 px-2 py-2 shadow-lg"
          :style="labelEditorStyle"
          @mousedown.stop
        >
          <template v-if="editingRectangleId === selectedProjectedRectangle.id">
            <input
              ref="rectangleLabelInput"
              v-model="rectangleLabelDraft"
              type="text"
              maxlength="50"
              class="w-40 rounded border border-gray-700 bg-[#111111] px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
              placeholder="Rectangle label"
              @keydown="handleRectangleLabelKeydown"
            />
            <div class="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                class="px-2 py-1 text-[11px] font-semibold rounded border border-gray-700 text-gray-200 hover:border-blue-500 hover:text-blue-100 transition"
                @click="cancelRectangleLabelEdit"
              >
                Cancel
              </button>
              <button
                type="button"
                class="px-2 py-1 text-[11px] font-semibold rounded border border-blue-500 text-blue-100 hover:bg-blue-500/20 transition"
                @click="saveRectangleLabel"
              >
                Save
              </button>
            </div>
          </template>
          <button
            v-else
            type="button"
            class="px-2 py-1 text-[11px] font-semibold rounded border border-gray-700 text-gray-200 hover:border-blue-500 hover:text-blue-100 transition"
            @click="beginRectangleLabelEdit(selectedProjectedRectangle.id)"
          >
            {{
              selectedProjectedRectangle.label
                ? "Edit Label"
                : "Add Label"
            }}
          </button>
        </div>
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
