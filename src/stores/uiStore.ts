import { defineStore } from "pinia";
import { ref } from "vue";

export type DrawingTool = "cursor" | "trendLine" | "rectangle";

export interface DrawingPoint {
  time: number;
  price: number;
  logical?: number;
}

export interface TrendLineDrawing {
  id: string;
  symbol: string;
  timeframe: string;
  start: DrawingPoint;
  end: DrawingPoint;
  color: string;
  lineWidth: number;
}

export interface RectangleDrawing {
  id: string;
  symbol: string;
  timeframe: string;
  start: DrawingPoint;
  end: DrawingPoint;
  color: string;
  lineWidth: number;
  fillOpacity: number;
  label: string;
}

export const useUiStore = defineStore("ui", () => {
  const isRightPanelOpen = ref(true);
  const drawingTool = ref<DrawingTool>("cursor");
  const trendLines = ref<TrendLineDrawing[]>([]);
  const rectangles = ref<RectangleDrawing[]>([]);

  function toggleRightPanel() {
    isRightPanelOpen.value = !isRightPanelOpen.value;
  }

  function setDrawingTool(tool: DrawingTool) {
    drawingTool.value = tool;
  }

  function addTrendLine(payload: {
    symbol: string;
    timeframe: string;
    start: DrawingPoint;
    end: DrawingPoint;
    color?: string;
    lineWidth?: number;
  }) {
    const id = `line-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    trendLines.value = [
      ...trendLines.value,
      {
        id,
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        start: payload.start,
        end: payload.end,
        color: payload.color ?? "#38bdf8",
        lineWidth: payload.lineWidth ?? 2,
      },
    ];
  }

  function getTrendLines(symbol: string, timeframe: string) {
    return trendLines.value.filter(
      (line) => line.symbol === symbol && line.timeframe === timeframe,
    );
  }

  function removeLastTrendLine(symbol: string, timeframe: string) {
    const index = trendLines.value
      .map((line, idx) => ({ line, idx }))
      .reverse()
      .find(
        ({ line }) => line.symbol === symbol && line.timeframe === timeframe,
      )?.idx;
    if (index == null) return;
    trendLines.value = trendLines.value.filter((_, idx) => idx !== index);
  }

  function clearTrendLines(symbol: string, timeframe: string) {
    trendLines.value = trendLines.value.filter(
      (line) => !(line.symbol === symbol && line.timeframe === timeframe),
    );
  }

  function addRectangle(payload: {
    symbol: string;
    timeframe: string;
    start: DrawingPoint;
    end: DrawingPoint;
    color?: string;
    lineWidth?: number;
    fillOpacity?: number;
    label?: string;
  }) {
    const id = `rect-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    rectangles.value = [
      ...rectangles.value,
      {
        id,
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        start: payload.start,
        end: payload.end,
        color: payload.color ?? "#f59e0b",
        lineWidth: payload.lineWidth ?? 2,
        fillOpacity: payload.fillOpacity ?? 0.14,
        label: payload.label ?? "",
      },
    ];
    return id;
  }

  function getRectangles(symbol: string, timeframe: string) {
    return rectangles.value.filter(
      (rect) => rect.symbol === symbol && rect.timeframe === timeframe,
    );
  }

  function removeLastRectangle(symbol: string, timeframe: string) {
    const index = rectangles.value
      .map((rect, idx) => ({ rect, idx }))
      .reverse()
      .find(
        ({ rect }) => rect.symbol === symbol && rect.timeframe === timeframe,
      )?.idx;
    if (index == null) return;
    rectangles.value = rectangles.value.filter((_, idx) => idx !== index);
  }

  function clearRectangles(symbol: string, timeframe: string) {
    rectangles.value = rectangles.value.filter(
      (rect) => !(rect.symbol === symbol && rect.timeframe === timeframe),
    );
  }

  function updateRectangle(
    id: string,
    updates: Partial<
      Pick<
        RectangleDrawing,
        "start" | "end" | "color" | "lineWidth" | "fillOpacity" | "label"
      >
    >,
  ) {
    rectangles.value = rectangles.value.map((rect) =>
      rect.id === id ? { ...rect, ...updates } : rect,
    );
  }

  return {
    isRightPanelOpen,
    drawingTool,
    trendLines,
    rectangles,
    toggleRightPanel,
    setDrawingTool,
    addTrendLine,
    getTrendLines,
    removeLastTrendLine,
    clearTrendLines,
    addRectangle,
    getRectangles,
    removeLastRectangle,
    clearRectangles,
    updateRectangle,
  };
});
