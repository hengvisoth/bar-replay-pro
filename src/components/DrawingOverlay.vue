<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import type {
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
} from "lightweight-charts";
import {
  useDrawingStore,
  type Drawing,
  type DrawingPoint,
  type DrawingType,
} from "../stores/drawingStore";

const props = defineProps<{
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}>();

type DraftDrawing = Omit<Drawing, "id">;
type PixelPoint = { x: number; y: number };

const drawingStore = useDrawingStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const draft = ref<DraftDrawing | null>(null);
const canInteract = computed(
  () => drawingStore.selectedTool !== "cursor" || drawingStore.drawings.length > 0
);

let chartCleanup: Array<() => void> = [];
let resizeObserver: ResizeObserver | null = null;

watch(
  () => props.chart,
  (chart) => {
    teardownChartBindings();
    if (chart) {
      setupChartBindings(chart);
      nextTick(renderAll);
    }
  },
  { immediate: true }
);

watch(
  () => props.series,
  () => {
    renderAll();
  }
);

watch(
  () => drawingStore.drawings,
  () => renderAll(),
  { deep: true }
);

watch(draft, () => renderAll(), { deep: true });
watch(
  () => drawingStore.selectedDrawingId,
  () => renderAll()
);

watch(
  () => drawingStore.selectedTool,
  (tool) => {
    if (tool !== "line" && tool !== "box") {
      draft.value = null;
      renderAll();
    }
  }
);

watch(
  () => props.container,
  (container) => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (container) {
      resizeObserver = new ResizeObserver(() => renderAll());
      resizeObserver.observe(container);
    }
    nextTick(renderAll);
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  teardownChartBindings();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

function setupChartBindings(chart: IChartApi) {
  const handleClick = (param: MouseEventParams) => {
    if (!param.point) return;
    handleChartClick(param);
  };
  chart.subscribeClick(handleClick);
  chartCleanup.push(() => chart.unsubscribeClick(handleClick));

  const handleCrosshairMove = (param: MouseEventParams) => {
    if (!draft.value || !param.point) return;
    const logical = pixelToLogical(param.point);
    if (!logical) return;
    if (draft.value.points.length === 1) {
      draft.value.points = [draft.value.points[0]!, logical];
    } else {
      draft.value.points[1] = logical;
    }
    renderAll();
  };
  chart.subscribeCrosshairMove(handleCrosshairMove);
  chartCleanup.push(() => chart.unsubscribeCrosshairMove(handleCrosshairMove));

  const rangeListener = () => renderAll();
  chart.timeScale().subscribeVisibleLogicalRangeChange(rangeListener);
  chartCleanup.push(() =>
    chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeListener)
  );
}

function teardownChartBindings() {
  chartCleanup.forEach((fn) => fn());
  chartCleanup = [];
}

function handleChartClick(param: MouseEventParams) {
  if (!param.point) return;
  const tool = drawingStore.selectedTool;
  if (tool === "cursor") {
    handleSelection(param.point);
    return;
  }
  const logical = pixelToLogical(param.point);
  if (!logical) return;

  if (tool === "text") {
    finalizeTextDrawing(logical);
    return;
  }

  if (tool === "line" || tool === "box") {
    handleShapeDrawing(tool, logical);
  }
}

function handleShapeDrawing(tool: DrawingType, logical: DrawingPoint) {
  if (!draft.value) {
    draft.value = {
      type: tool,
      color: drawingStore.activeColor,
      lineWidth: drawingStore.defaultLineWidth,
      points: [logical, logical],
    };
    return;
  }

  if (draft.value.type !== tool) {
    draft.value = {
      type: tool,
      color: drawingStore.activeColor,
      lineWidth: drawingStore.defaultLineWidth,
      points: [logical, logical],
    };
    return;
  }

  draft.value.points = [draft.value.points[0]!, logical];
  drawingStore.addDrawing({
    type: draft.value.type,
    color: draft.value.color,
    lineWidth: draft.value.lineWidth,
    points: [...draft.value.points],
  });
  draft.value = null;
  drawingStore.setSelectedTool("cursor");
}

function finalizeTextDrawing(anchor: DrawingPoint) {
  const text = window.prompt("Enter note text", "") ?? "";
  if (!text.trim()) {
    drawingStore.setSelectedTool("cursor");
    return;
  }
  drawingStore.addDrawing({
    type: "text",
    color: drawingStore.activeColor,
    lineWidth: drawingStore.defaultLineWidth,
    points: [anchor],
    text: text.trim(),
  });
  drawingStore.setSelectedTool("cursor");
}

function handleSelection(point: PixelPoint) {
  const hit = findDrawingAt(point);
  drawingStore.setSelectedDrawing(hit ? hit.id : null);
  renderAll();
}

function findDrawingAt(point: PixelPoint) {
  const drawings = [...drawingStore.drawings].reverse();
  for (const drawing of drawings) {
    if (hitTestDrawing(drawing, point)) {
      return drawing;
    }
  }
  return null;
}

function hitTestDrawing(drawing: Drawing, point: PixelPoint) {
  if (!props.chart || !props.series) return false;
  if (drawing.type === "line") {
    return hitTestLine(drawing, point);
  }
  if (drawing.type === "box") {
    return hitTestBox(drawing, point);
  }
  if (drawing.type === "text") {
    return hitTestText(drawing, point);
  }
  return false;
}

function hitTestLine(drawing: Drawing, point: PixelPoint) {
  const [start, end] = drawing.points;
  if (!start || !end) return false;
  const startPx = logicalToPixel(start);
  const endPx = logicalToPixel(end);
  if (!startPx || !endPx) return false;
  const dist = distancePointToSegment(point, startPx, endPx);
  return dist <= 8;
}

function hitTestBox(drawing: Drawing, point: PixelPoint) {
  const [a, b] = drawing.points;
  if (!a || !b) return false;
  const aPx = logicalToPixel(a);
  const bPx = logicalToPixel(b);
  if (!aPx || !bPx) return false;
  const minX = Math.min(aPx.x, bPx.x);
  const maxX = Math.max(aPx.x, bPx.x);
  const minY = Math.min(aPx.y, bPx.y);
  const maxY = Math.max(aPx.y, bPx.y);
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function hitTestText(drawing: Drawing, point: PixelPoint) {
  const anchor = drawing.points[0];
  if (!anchor) return false;
  const anchorPx = logicalToPixel(anchor);
  if (!anchorPx) return false;
  const ctx = canvasRef.value?.getContext("2d");
  if (!ctx) return false;
  const text = drawing.text || "";
  ctx.save();
  ctx.font = "12px 'Inter', sans-serif";
  const textWidth = Math.max(ctx.measureText(text || "Text").width, 40);
  ctx.restore();
  const padding = 6;
  const height = 24;
  const x = anchorPx.x;
  const y = anchorPx.y;
  return (
    point.x >= x &&
    point.x <= x + textWidth + padding * 2 &&
    point.y >= y &&
    point.y <= y + height
  );
}

function distancePointToSegment(p: PixelPoint, a: PixelPoint, b: PixelPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t =
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = a.x + clamped * dx;
  const projY = a.y + clamped * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function handleKeydown(event: KeyboardEvent) {
  if (draft.value && event.key === "Escape") {
    draft.value = null;
    drawingStore.setSelectedTool("cursor");
    renderAll();
    return;
  }
  if (
    event.key !== "Delete" &&
    event.key !== "Backspace"
  ) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
    return;
  }
  if (drawingStore.selectedDrawingId) {
    drawingStore.removeDrawing(drawingStore.selectedDrawingId);
    event.preventDefault();
  }
}

function renderAll() {
  const canvas = canvasRef.value;
  const container = props.container;
  if (!canvas || !container) return;
  const rect = container.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  drawingStore.drawings.forEach((drawing) => drawShape(ctx, drawing));
  if (draft.value) {
    drawShape(ctx, draft.value, true);
  }
  ctx.restore();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  drawing: DraftDrawing | Drawing,
  isDraft = false
) {
  if (!props.chart || !props.series) return;
  if (drawing.type === "line") {
    drawTrendLine(ctx, drawing, isDraft);
  } else if (drawing.type === "box") {
    drawBox(ctx, drawing, isDraft);
  } else if (drawing.type === "text") {
    drawText(ctx, drawing as DraftDrawing, isDraft);
  }
}

function drawTrendLine(
  ctx: CanvasRenderingContext2D,
  drawing: DraftDrawing | Drawing,
  isDraft: boolean
) {
  const [a, b] = drawing.points;
  if (!a || !b) return;
  const start = logicalToPixel(a);
  const end = logicalToPixel(b);
  if (!start || !end) return;
  ctx.save();
  ctx.lineWidth = (drawing.lineWidth || 1) + (isSelectedDrawing(drawing) ? 1 : 0);
  ctx.strokeStyle = drawing.color;
  ctx.setLineDash(isDraft ? [6, 4] : isSelectedDrawing(drawing) ? [2, 2] : []);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  drawing: DraftDrawing | Drawing,
  isDraft: boolean
) {
  const [a, b] = drawing.points;
  if (!a || !b) return;
  const start = logicalToPixel(a);
  const end = logicalToPixel(b);
  if (!start || !end) return;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  ctx.save();
  ctx.fillStyle = colorWithAlpha(drawing.color, 0.15);
  ctx.strokeStyle = drawing.color;
  ctx.lineWidth = (drawing.lineWidth || 1) + (isSelectedDrawing(drawing) ? 1 : 0);
  if (isDraft) {
    ctx.setLineDash([4, 4]);
  } else if (isSelectedDrawing(drawing)) {
    ctx.setLineDash([2, 2]);
  }
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  drawing: DraftDrawing | Drawing,
  _isDraft: boolean
) {
  const anchor = drawing.points[0];
  if (!anchor) return;
  const anchorPx = logicalToPixel(anchor);
  if (!anchorPx) return;
  const text = drawing.text || "";
  ctx.save();
  ctx.font = "12px 'Inter', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const padding = 6;
  const height = 24;
  const textWidth = Math.max(ctx.measureText(text || "Text").width, 20);
  const x = anchorPx.x;
  const y = anchorPx.y;
  ctx.fillStyle = colorWithAlpha(drawing.color, 0.2);
  ctx.strokeStyle = drawing.color;
  ctx.lineWidth = isSelectedDrawing(drawing) ? 1.5 : 1;
  ctx.fillRect(x, y, textWidth + padding * 2, height);
  ctx.strokeRect(x, y, textWidth + padding * 2, height);
  ctx.fillStyle = drawing.color;
  ctx.fillText(text || "Text", x + padding, y + height / 2);
  ctx.restore();
}

function colorWithAlpha(color: string, alpha: number) {
  const hex = color.replace("#", "");
  if (hex.length !== 6) {
    return color;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function logicalToPixel(point: DrawingPoint): PixelPoint | null {
  if (!props.chart || !props.series) return null;
  const x = props.chart.timeScale().timeToCoordinate(point.time as Time);
  const y = props.series.priceToCoordinate(point.price);
  if (x == null || y == null) return null;
  return { x, y };
}

function pixelToLogical(point: PixelPoint): DrawingPoint | null {
  if (!props.chart || !props.series) return null;
  const time = props.chart.timeScale().coordinateToTime(point.x);
  const price = props.series.coordinateToPrice(point.y);
  if (typeof time !== "number" || price == null) return null;
  return { time, price };
}

function isSelectedDrawing(drawing: DraftDrawing | Drawing) {
  if (!("id" in drawing)) return false;
  return drawingStore.selectedDrawingId === drawing.id;
}
</script>

<template>
  <div
    class="absolute inset-0 pointer-events-none"
    :class="canInteract ? 'cursor-crosshair' : ''"
  >
    <canvas
      ref="canvasRef"
      class="w-full h-full pointer-events-none"
    ></canvas>
  </div>
</template>
