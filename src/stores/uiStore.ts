import { defineStore } from "pinia";
import { ref } from "vue";

export type DrawingTool = "cursor" | "trendLine";

export interface DrawingPoint {
  time: number;
  price: number;
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

export const useUiStore = defineStore("ui", () => {
  const isRightPanelOpen = ref(true);
  const drawingTool = ref<DrawingTool>("cursor");
  const trendLines = ref<TrendLineDrawing[]>([]);

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

  return {
    isRightPanelOpen,
    drawingTool,
    trendLines,
    toggleRightPanel,
    setDrawingTool,
    addTrendLine,
    getTrendLines,
    removeLastTrendLine,
    clearTrendLines,
  };
});
