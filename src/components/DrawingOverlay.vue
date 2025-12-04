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
  Coordinate,
  Time,
} from "lightweight-charts";
import { useDrawingStore } from "../stores/drawingStore";
import type { Candle } from "../data/types";
import type {
  DrawingPaneTarget,
  DrawingShape,
  DrawingToolId,
  LogicalPoint,
  StrokeStyle,
  TrendLineDrawing,
  RayDrawing,
  RectangleDrawing,
  ParallelChannelDrawing,
  TriangleDrawing,
  BrushDrawing,
  TextDrawing,
  HorizontalLineDrawing,
  VerticalLineDrawing,
  PriceLabelDrawing,
  CalloutDrawing,
  IconDrawing,
} from "../data/drawings";

const props = defineProps<{
  paneId: DrawingPaneTarget;
  chart: IChartApi | null;
  series: ISeriesApi<any> | null;
  container: HTMLElement | null;
  dataset: Candle[];
  isActive: boolean;
}>();

const drawingStore = useDrawingStore();

type PixelPoint = { x: number; y: number };

interface DraftState {
  toolId: DrawingToolId;
  points: LogicalPoint[];
}

interface DragState {
  drawingId: string;
  mode: "move" | "resize";
  handleIndex?: number;
  startPointer: PixelPoint;
  startLogical: LogicalPoint;
  originalPoints: LogicalPoint[];
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
const overlayRef = ref<HTMLDivElement | null>(null);
const draft = ref<DraftState | null>(null);
const previewPoint = ref<LogicalPoint | null>(null);
const dragState = ref<DragState | null>(null);
const hoveredHandle = ref<{ drawingId: string; index: number } | null>(null);
const isPointerDown = ref(false);
const currentPointer = ref<PixelPoint | null>(null);
const resizeObserver = ref<ResizeObserver | null>(null);
let chartSubscriptions: Array<() => void> = [];

const drawingsForPane = computed(() =>
  drawingStore.visibleDrawings.filter(
    (drawing) => (drawing.pane ?? "main") === props.paneId && !drawing.hidden
  )
);

const selectedDrawingId = computed(() => drawingStore.selectedDrawingId);

watch([drawingsForPane, draft, previewPoint], () => renderCanvas(), {
  deep: true,
});

watch(
  () => props.container,
  () => {
    setupResizeObserver();
    nextTick(renderCanvas);
  },
  { immediate: true }
);

watch(
  () => props.chart,
  (chart) => {
    teardownChartSubscriptions();
    if (!chart) return;
    const rangeHandler = () => renderCanvas();
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
    chartSubscriptions.push(() =>
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
    );
  },
  { immediate: true }
);

watch(
  () => drawingStore.showAll,
  () => {
    renderCanvas();
  }
);

onMounted(() => {
  if (overlayRef.value) {
    overlayRef.value.addEventListener("pointerdown", handlePointerDown);
    overlayRef.value.addEventListener("pointermove", handlePointerMove);
    overlayRef.value.addEventListener("pointerup", handlePointerUp);
    overlayRef.value.addEventListener("pointerleave", handlePointerCancel);
  }
  setupResizeObserver();
  nextTick(renderCanvas);
});

onUnmounted(() => {
  teardownChartSubscriptions();
  if (overlayRef.value) {
    overlayRef.value.removeEventListener("pointerdown", handlePointerDown);
    overlayRef.value.removeEventListener("pointermove", handlePointerMove);
    overlayRef.value.removeEventListener("pointerup", handlePointerUp);
    overlayRef.value.removeEventListener("pointerleave", handlePointerCancel);
  }
  if (resizeObserver.value && props.container) {
    resizeObserver.value.disconnect();
    resizeObserver.value = null;
  }
});

function setupResizeObserver() {
  if (resizeObserver.value) {
    resizeObserver.value.disconnect();
    resizeObserver.value = null;
  }
  if (!props.container) return;
  resizeObserver.value = new ResizeObserver(() => renderCanvas());
  resizeObserver.value.observe(props.container);
}

function teardownChartSubscriptions() {
  chartSubscriptions.forEach((unsubscribe) => unsubscribe());
  chartSubscriptions = [];
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto.randomUUID as () => string)();
  }
  return `drawing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOverlayRect() {
  return props.container?.getBoundingClientRect() ?? null;
}

function getLocalPoint(event: PointerEvent): PixelPoint | null {
  const rect = getOverlayRect();
  if (!rect) return null;
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function pixelToLogical(point: PixelPoint): LogicalPoint | null {
  if (!props.chart || !props.series) return null;
  const time = props.chart.timeScale().coordinateToTime(point.x as Coordinate);
  const price = props.series.coordinateToPrice(point.y);
  if (typeof time !== "number" || price == null) return null;
  return { time, price };
}

function logicalToPixel(point: LogicalPoint): PixelPoint | null {
  if (!props.chart || !props.series) return null;
  const x = props.chart.timeScale().timeToCoordinate(point.time as Time);
  const y = props.series.priceToCoordinate(point.price);
  if (x == null || y == null) return null;
  return { x, y };
}

function applyMagnet(point: LogicalPoint): LogicalPoint {
  if (drawingStore.magnetMode === "off" || !props.dataset.length) {
    return point;
  }
  let closest: Candle | null = null;
  let minTime = Number.MAX_SAFE_INTEGER;
  for (const candle of props.dataset) {
    const dist = Math.abs(candle.time - point.time);
    if (dist < minTime) {
      minTime = dist;
      closest = candle;
    }
  }
  if (!closest) return point;
  const priceCandidates = [closest.open, closest.high, closest.low, closest.close].filter(
    (price): price is number => typeof price === "number"
  );
  let snappedPrice = point.price;
  let bestDiff = Number.MAX_SAFE_INTEGER;
  for (const price of priceCandidates) {
    const diff = Math.abs(price - point.price);
    if (diff < bestDiff) {
      bestDiff = diff;
      snappedPrice = price;
    }
  }
  const snapped: LogicalPoint = { time: closest.time, price: snappedPrice };
  if (drawingStore.magnetMode === "weak") {
    const priceRange = Math.max(closest.high - closest.low, 1);
    if (bestDiff > priceRange * 0.5) {
      return point;
    }
  }
  return snapped;
}

function handlePointerDown(event: PointerEvent) {
  if (!props.container) return;
  const local = getLocalPoint(event);
  if (!local) return;
  isPointerDown.value = true;
  currentPointer.value = local;

  if (drawingStore.activeTool === "cursor") {
    const handleHit = detectHandle(local);
    if (handleHit && !isDrawingLocked(handleHit.drawingId)) {
      startHandleDrag(handleHit, local);
      return;
    }
    const hitDrawing = findDrawingAt(local);
    drawingStore.setSelectedDrawing(hitDrawing?.id ?? null);
    if (hitDrawing && !hitDrawing.locked) {
      startMoveDrag(hitDrawing, local);
    }
    return;
  }

  if (!props.isActive) return;
  const logical = pixelToLogical(local);
  if (!logical) return;
  const snapped = applyMagnet(logical);

  const definition = drawingStore.activeToolDefinition;
  if (!definition) return;

  if (definition.kind === "freehand") {
    draft.value = { toolId: drawingStore.activeTool as DrawingToolId, points: [snapped] };
    overlayRef.value?.setPointerCapture(event.pointerId);
    return;
  }

  if (!draft.value || draft.value.toolId !== drawingStore.activeTool) {
    draft.value = { toolId: drawingStore.activeTool as DrawingToolId, points: [snapped] };
  } else {
    draft.value.points = [...draft.value.points, snapped];
  }

  if (draft.value.points.length >= definition.maxPoints) {
    finalizeDraft();
  } else {
    overlayRef.value?.setPointerCapture(event.pointerId);
  }
}

function handlePointerMove(event: PointerEvent) {
  const local = getLocalPoint(event);
  if (!local) return;
  currentPointer.value = local;

  if (dragState.value) {
    handleDragMove(local);
    return;
  }

  if (drawingStore.activeTool === "cursor") {
    const hit = findDrawingAt(local);
    drawingStore.setHoveredDrawing(hit?.id ?? null);
    hoveredHandle.value = detectHandle(local);
    return;
  }

  if (!props.isActive) return;
  if (!draft.value) return;
  const definition = drawingStore.activeToolDefinition;
  if (definition?.kind === "freehand" && isPointerDown.value) {
    const logical = pixelToLogical(local);
    if (!logical) return;
    const snapped = applyMagnet(logical);
    draft.value.points = [...draft.value.points, snapped];
    renderCanvas();
    return;
  }
  const logical = pixelToLogical(local);
  if (!logical) return;
  const snapped = applyMagnet(logical);
  previewPoint.value = snapped;
  renderCanvas();
}

function handlePointerUp(event: PointerEvent) {
  if (dragState.value) {
    finalizeDrag();
  }
  const definition = drawingStore.activeToolDefinition;
  if (draft.value && definition?.kind === "freehand") {
    if (draft.value.points.length > 1) {
      finalizeDraft();
    } else {
      draft.value = null;
    }
  }
  isPointerDown.value = false;
  overlayRef.value?.releasePointerCapture(event.pointerId);
  previewPoint.value = null;
  renderCanvas();
}

function handlePointerCancel() {
  dragState.value = null;
  draft.value = null;
  previewPoint.value = null;
  hoveredHandle.value = null;
  isPointerDown.value = false;
  renderCanvas();
}

function startHandleDrag(
  handle: { drawingId: string; index: number },
  pointer: PixelPoint
) {
  const drawing = drawingsForPane.value.find((shape) => shape.id === handle.drawingId);
  if (!drawing) return;
  drawingStore.captureSnapshot();
  dragState.value = {
    drawingId: drawing.id,
    mode: "resize",
    handleIndex: handle.index,
    startPointer: pointer,
    startLogical: pixelToLogical(pointer) ?? { time: 0, price: 0 },
    originalPoints: getDrawingPoints(drawing),
  };
}

function startMoveDrag(drawing: DrawingShape, pointer: PixelPoint) {
  drawingStore.captureSnapshot();
  dragState.value = {
    drawingId: drawing.id,
    mode: "move",
    startPointer: pointer,
    startLogical: pixelToLogical(pointer) ?? { time: 0, price: 0 },
    originalPoints: getDrawingPoints(drawing),
  };
}

function handleDragMove(pointer: PixelPoint) {
  if (!dragState.value) return;
  const drawing = drawingsForPane.value.find(
    (shape) => shape.id === dragState.value?.drawingId
  );
  if (!drawing) return;
  const currentLogical = pixelToLogical(pointer);
  if (!currentLogical) return;
  const deltaTime = currentLogical.time - dragState.value.startLogical.time;
  const deltaPrice = currentLogical.price - dragState.value.startLogical.price;

  if (dragState.value.mode === "move") {
    const newPoints = dragState.value.originalPoints.map((point) => ({
      time: point.time + deltaTime,
      price: point.price + deltaPrice,
    }));
    applyPointUpdate(drawing, newPoints);
    return;
  }

  if (dragState.value.mode === "resize" && typeof dragState.value.handleIndex === "number") {
    const newPoints = [...dragState.value.originalPoints];
    newPoints[dragState.value.handleIndex] = {
      time: currentLogical.time,
      price: currentLogical.price,
    };
    applyPointUpdate(drawing, newPoints);
  }
}

function finalizeDrag() {
  dragState.value = null;
  renderCanvas();
}

function applyPointUpdate(drawing: DrawingShape, points: LogicalPoint[]) {
  if (drawingHasPoints(drawing)) {
    drawingStore.updateDrawing(
      drawing.id,
      { points, updatedAt: Date.now() } as Partial<DrawingShape>,
      { recordHistory: false }
    );
  } else if (
    drawing.type === "text" ||
    drawing.type === "price-label" ||
    drawing.type === "callout" ||
    drawing.type === "icon"
  ) {
    drawingStore.updateDrawing(
      drawing.id,
      { point: points[0] } as Partial<DrawingShape>,
      { recordHistory: false }
    );
  } else if (drawing.type === "horizontal-line") {
    drawingStore.updateDrawing(
      drawing.id,
      { price: points[0]?.price ?? drawing.price },
      { recordHistory: false }
    );
  } else if (drawing.type === "vertical-line") {
    drawingStore.updateDrawing(
      drawing.id,
      { time: points[0]?.time ?? drawing.time },
      { recordHistory: false }
    );
  }
}

function detectHandle(point: PixelPoint) {
  const radius = 6;
  for (const drawing of drawingsForPane.value) {
    const points = getDrawingPoints(drawing);
    for (let index = 0; index < points.length; index += 1) {
      const anchor = points[index];
      if (!anchor) continue;
      const pixel = logicalToPixel(anchor);
      if (!pixel) continue;
      const dist = Math.hypot(point.x - pixel.x, point.y - pixel.y);
      if (dist <= radius) {
        return { drawingId: drawing.id, index };
      }
    }
  }
  return null;
}

function getDrawingPoints(drawing: DrawingShape): LogicalPoint[] {
  if (drawingHasPoints(drawing)) {
    return drawing.points;
  }
  if (drawing.type === "text" || drawing.type === "price-label" || drawing.type === "callout" || drawing.type === "icon") {
    return [drawing.point];
  }
  if (drawing.type === "horizontal-line") {
    return [{ time: props.dataset[0]?.time ?? 0, price: drawing.price }];
  }
  if (drawing.type === "vertical-line") {
    return [{ time: drawing.time, price: props.dataset[0]?.close ?? 0 }];
  }
  return [];
}

function findDrawingAt(point: PixelPoint) {
  for (const drawing of [...drawingsForPane.value].reverse()) {
    if (hitTestDrawing(drawing, point)) {
      return drawing;
    }
  }
  return null;
}

function hitTestDrawing(drawing: DrawingShape, point: PixelPoint) {
  if (drawingHasPoints(drawing) && drawing.points.length >= 2) {
    const pixels = drawing.points
      .map((logical) => logicalToPixel(logical))
      .filter((px): px is PixelPoint => !!px);
    if (drawing.type === "rectangle" && pixels.length >= 2) {
      const first = pixels[0];
      const second = pixels[1];
      if (!first || !second) return false;
      const minX = Math.min(first.x, second.x);
      const maxX = Math.max(first.x, second.x);
      const minY = Math.min(first.y, second.y);
      const maxY = Math.max(first.y, second.y);
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    }
    if (pixels.length >= 2) {
      const first = pixels[0];
      const last = pixels[pixels.length - 1];
      if (!first || !last) return false;
      const dist = distancePointToSegment(point, first, last);
      return dist < 8;
    }
  }
  if (drawing.type === "text" || drawing.type === "price-label" || drawing.type === "callout") {
    const pixel = logicalToPixel(drawing.point);
    if (!pixel) return false;
    const width = 80;
    const height = 26;
    return (
      point.x >= pixel.x &&
      point.x <= pixel.x + width &&
      point.y >= pixel.y - height / 2 &&
      point.y <= pixel.y + height / 2
    );
  }
  if (drawing.type === "horizontal-line") {
    const pricePixel = props.series?.priceToCoordinate(drawing.price);
    if (pricePixel == null) return false;
    return Math.abs(point.y - pricePixel) < 5;
  }
  if (drawing.type === "vertical-line") {
    const x = props.chart?.timeScale().timeToCoordinate(drawing.time as Time);
    if (x == null) return false;
    return Math.abs(point.x - x) < 5;
  }
  return false;
}

function distancePointToSegment(point: PixelPoint, start: PixelPoint, end: PixelPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = start.x + clamped * dx;
  const projY = start.y + clamped * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function finalizeDraft() {
  if (!draft.value) return;
  const definition = drawingStore.activeToolDefinition;
  if (!definition) return;
  const points = [...draft.value.points];
  if (!points.length) return;
  const style = drawingStore.getToolStyle(draft.value.toolId);
  const stroke = {
    color: style.strokeColor,
    width: style.strokeWidth,
    style: style.strokeStyle ?? "solid",
  } as StrokeStyle;
  const base = {
    id: createId(),
    pane: props.paneId,
    hidden: false,
    locked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  switch (draft.value.toolId) {
    case "trend-line":
      if (points.length < 2) break;
      if (!points[0] || !points[1]) break;
      drawingStore.addDrawing({
        ...base,
        type: "trend-line",
        points: [points[0], points[1]],
        stroke,
        fill: undefined,
      } as DrawingShape);
      break;
    case "ray":
      if (points.length < 2) break;
      if (!points[0] || !points[1]) break;
      drawingStore.addDrawing({
        ...base,
        type: "ray",
        points: [points[0], points[1]],
        stroke,
        direction: "right",
      } as DrawingShape);
      break;
    case "rectangle":
      if (points.length < 2) break;
      if (!points[0] || !points[1]) break;
      drawingStore.addDrawing({
        ...base,
        type: "rectangle",
        points: [points[0], points[1]],
        stroke,
        fill: style.fillColor
          ? { color: style.fillColor, opacity: style.fillOpacity ?? 0.2 }
          : undefined,
      } as DrawingShape);
      break;
    case "parallel-channel":
      if (points.length < 3) break;
      if (!points[0] || !points[1] || !points[2]) break;
      drawingStore.addDrawing({
        ...base,
        type: "parallel-channel",
        points: [points[0], points[1], points[2]],
        stroke,
        fill: style.fillColor
          ? { color: style.fillColor, opacity: style.fillOpacity ?? 0.15 }
          : undefined,
      } as DrawingShape);
      break;
    case "triangle":
      if (points.length < 3) break;
      if (!points[0] || !points[1] || !points[2]) break;
      drawingStore.addDrawing({
        ...base,
        type: "triangle",
        points: [points[0], points[1], points[2]],
        stroke,
        fill: style.fillColor
          ? { color: style.fillColor, opacity: style.fillOpacity ?? 0.18 }
          : undefined,
      } as DrawingShape);
      break;
    case "brush":
      if (points.length < 2) break;
      drawingStore.addDrawing({
        ...base,
        type: "brush",
        points,
        stroke,
      } as DrawingShape);
      break;
    case "text":
      if (!points[0]) break;
      drawingStore.addDrawing({
        ...base,
        type: "text",
        point: points[0],
        text: "Text",
        textColor: style.textColor ?? style.strokeColor,
        background: style.fillColor
          ? { color: style.fillColor, opacity: style.fillOpacity ?? 0.2 }
          : undefined,
        fontFamily: "Inter, sans-serif",
        fontSize: style.fontSize ?? 12,
        padding: 6,
      } as DrawingShape);
      break;
    case "horizontal-line":
      if (!points[0]) break;
      drawingStore.addDrawing({
        ...base,
        type: "horizontal-line",
        price: points[0].price,
        stroke,
      } as DrawingShape);
      break;
    case "vertical-line":
      if (!points[0]) break;
      drawingStore.addDrawing({
        ...base,
        type: "vertical-line",
        time: points[0].time,
        stroke,
      } as DrawingShape);
      break;
    case "price-label":
      if (!points[0]) break;
      drawingStore.addDrawing({
        ...base,
        type: "price-label",
        point: points[0],
        text: `@ ${points[0].price.toFixed(2)}`,
        textColor: style.textColor ?? "#ffffff",
        background: {
          color: style.fillColor ?? style.strokeColor,
          opacity: style.fillOpacity ?? 0.2,
        },
      } as DrawingShape);
      break;
    case "callout":
      if (!points[0]) break;
      drawingStore.addDrawing({
        ...base,
        type: "callout",
        point: points[0],
        text: "Note",
        textColor: style.textColor ?? "#111827",
        background: {
          color: style.fillColor ?? "#ffffff",
          opacity: style.fillOpacity ?? 0.8,
        },
        anchorMode: "logical",
      } as DrawingShape);
      break;
    case "icon":
      if (!points[0]) break;
      drawingStore.addDrawing({
        ...base,
        type: "icon",
        point: points[0],
        icon: "★",
        color: style.textColor ?? style.strokeColor,
        size: 14,
      } as DrawingShape);
      break;
    default:
      break;
  }

  draft.value = null;
  previewPoint.value = null;
  drawingStore.setSelectedTool("cursor");
}

function isDrawingLocked(id: string) {
  return drawingsForPane.value.find((drawing) => drawing.id === id)?.locked;
}

function renderCanvas() {
  const canvas = canvasRef.value;
  const container = props.container;
  if (!canvas || !container) return;
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  for (const drawing of drawingsForPane.value) {
    drawShape(ctx, drawing);
  }
  if (draft.value && previewPoint.value) {
    const preview = [...draft.value.points, previewPoint.value];
    drawDraft(ctx, draft.value.toolId, preview);
  }
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, drawing: DrawingShape) {
  switch (drawing.type) {
    case "trend-line":
      return drawLineShape(ctx, drawing as TrendLineDrawing);
    case "ray":
      return drawRay(ctx, drawing as RayDrawing);
    case "rectangle":
      return drawRectangle(ctx, drawing as RectangleDrawing);
    case "parallel-channel":
      return drawParallelChannel(ctx, drawing as ParallelChannelDrawing);
    case "triangle":
      return drawPolygon(ctx, drawing as TriangleDrawing);
    case "brush":
      return drawBrush(ctx, drawing as BrushDrawing);
    case "text":
      return drawText(ctx, drawing as TextDrawing);
    case "horizontal-line":
      return drawHorizontalLine(ctx, drawing as HorizontalLineDrawing);
    case "vertical-line":
      return drawVerticalLine(ctx, drawing as VerticalLineDrawing);
    case "price-label":
      return drawPriceLabel(ctx, drawing as PriceLabelDrawing);
    case "callout":
      return drawCallout(ctx, drawing as CalloutDrawing);
    case "icon":
      return drawIcon(ctx, drawing as IconDrawing);
    default:
      return;
  }
}

function drawLineShape(ctx: CanvasRenderingContext2D, drawing: TrendLineDrawing) {
  if (drawing.points.length < 2) return;
  const [first, last] = [drawing.points[0], drawing.points[drawing.points.length - 1]];
  if (!first || !last) return;
  const start = logicalToPixel(first);
  const end = logicalToPixel(last);
  if (!start || !end) return;
  ctx.save();
  setStrokeStyle(ctx, drawing.stroke);
  if (drawing.id === selectedDrawingId.value) {
    ctx.lineWidth = drawing.stroke.width + 1;
  }
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  if (drawing.id === selectedDrawingId.value) {
    drawHandles(ctx, [start, end]);
  }
  ctx.restore();
}

function drawRay(ctx: CanvasRenderingContext2D, drawing: RayDrawing) {
  if (drawing.points.length < 2) return;
  const startPoint = drawing.points[0];
  const endPoint = drawing.points[1];
  if (!startPoint || !endPoint) return;
  const start = logicalToPixel(startPoint);
  const end = logicalToPixel(endPoint);
  if (!start || !end) return;
  const direction = drawing.direction === "left" ? -1 : 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = (dx / length) * direction;
  const unitY = (dy / length) * direction;
  const farPoint = {
    x: end.x + unitX * 2000,
    y: end.y + unitY * 2000,
  };
  ctx.save();
  setStrokeStyle(ctx, drawing.stroke);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(farPoint.x, farPoint.y);
  ctx.stroke();
  ctx.restore();
}

function drawRectangle(ctx: CanvasRenderingContext2D, drawing: RectangleDrawing) {
  if (drawing.points.length < 2) return;
  const first = drawing.points[0];
  const second = drawing.points[1];
  if (!first || !second) return;
  const start = logicalToPixel(first);
  const end = logicalToPixel(second);
  if (!start || !end) return;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  ctx.save();
  if (drawing.fill) {
    ctx.fillStyle = rgbaColor(drawing.fill.color, drawing.fill.opacity ?? 0.2);
    ctx.fillRect(x, y, width, height);
  }
  setStrokeStyle(ctx, drawing.stroke);
  ctx.strokeRect(x, y, width, height);
  if (drawing.id === selectedDrawingId.value) {
    drawHandles(ctx, [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ]);
  }
  ctx.restore();
}

function drawParallelChannel(ctx: CanvasRenderingContext2D, drawing: ParallelChannelDrawing) {
  if (drawing.points.length < 3) return;
  const [a, b, widthPoint] = drawing.points;
  if (!a || !b || !widthPoint) return;
  const aPx = logicalToPixel(a);
  const bPx = logicalToPixel(b);
  const wPx = logicalToPixel(widthPoint);
  if (!aPx || !bPx || !wPx) return;
  const base = { x: bPx.x - aPx.x, y: bPx.y - aPx.y };
  const len = Math.hypot(base.x, base.y) || 1;
  const normal = { x: -base.y / len, y: base.x / len };
  const distance =
    (normal.x * (wPx.x - aPx.x) + normal.y * (wPx.y - aPx.y));
  const offset = { x: normal.x * distance, y: normal.y * distance };

  const cPx = { x: aPx.x + offset.x, y: aPx.y + offset.y };
  const dPx = { x: bPx.x + offset.x, y: bPx.y + offset.y };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(aPx.x, aPx.y);
  ctx.lineTo(bPx.x, bPx.y);
  ctx.lineTo(dPx.x, dPx.y);
  ctx.lineTo(cPx.x, cPx.y);
  ctx.closePath();
  if (drawing.fill) {
    ctx.fillStyle = rgbaColor(drawing.fill.color, drawing.fill.opacity ?? 0.12);
    ctx.fill();
  }
  setStrokeStyle(ctx, drawing.stroke);
  ctx.stroke();
  if (drawing.id === selectedDrawingId.value) {
    drawHandles(ctx, [aPx, bPx, wPx]);
  }
  ctx.restore();
}

function drawPolygon(ctx: CanvasRenderingContext2D, drawing: TriangleDrawing) {
  if (drawing.points.length < 3) return;
  const pixels = drawing.points
    .map((point) => logicalToPixel(point))
    .filter((px): px is PixelPoint => !!px);
  if (pixels.length < 3) return;
  ctx.save();
  ctx.beginPath();
  const first = pixels[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pixels.length; i += 1) {
    const point = pixels[i];
    if (!point) continue;
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  if (drawing.fill) {
    ctx.fillStyle = rgbaColor(drawing.fill.color, drawing.fill.opacity ?? 0.2);
    ctx.fill();
  }
  setStrokeStyle(ctx, drawing.stroke);
  ctx.stroke();
  if (drawing.id === selectedDrawingId.value) {
    drawHandles(ctx, pixels);
  }
  ctx.restore();
}

function drawBrush(ctx: CanvasRenderingContext2D, drawing: BrushDrawing) {
  if (drawing.points.length < 2) return;
  const pixels = drawing.points
    .map((point) => logicalToPixel(point))
    .filter((px): px is PixelPoint => !!px);
  if (pixels.length < 2) return;
  ctx.save();
  setStrokeStyle(ctx, drawing.stroke);
  ctx.beginPath();
  const first = pixels[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pixels.length; i += 1) {
    const point = pixels[i];
    if (!point) continue;
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, drawing: TextDrawing) {
  const anchorPoint = drawing.point;
  if (!anchorPoint) return;
  const anchor = logicalToPixel(anchorPoint);
  if (!anchor) return;
  ctx.save();
  const padding = drawing.padding ?? 6;
  ctx.font = `${drawing.fontSize ?? 12}px ${drawing.fontFamily ?? "Inter, sans-serif"}`;
  const textWidth = ctx.measureText(drawing.text || "Text").width;
  const width = textWidth + padding * 2;
  const height = (drawing.fontSize ?? 12) + padding * 2;
  if (drawing.background) {
    ctx.fillStyle = rgbaColor(drawing.background.color, drawing.background.opacity ?? 0.2);
    ctx.fillRect(anchor.x, anchor.y - height, width, height);
  }
  ctx.fillStyle = drawing.textColor ?? "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(drawing.text || "Text", anchor.x + padding, anchor.y - height / 2);
  if (drawing.id === selectedDrawingId.value) {
    drawHandles(ctx, [anchor]);
  }
  ctx.restore();
}

function drawHorizontalLine(ctx: CanvasRenderingContext2D, drawing: HorizontalLineDrawing) {
  const y = props.series?.priceToCoordinate(drawing.price);
  if (y == null || !props.chart) return;
  const width = props.container?.clientWidth ?? 0;
  ctx.save();
  setStrokeStyle(ctx, drawing.stroke);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.restore();
}

function drawVerticalLine(ctx: CanvasRenderingContext2D, drawing: VerticalLineDrawing) {
  const x = props.chart?.timeScale().timeToCoordinate(drawing.time as Time);
  if (x == null) return;
  const height = props.container?.clientHeight ?? 0;
  ctx.save();
  setStrokeStyle(ctx, drawing.stroke);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.restore();
}

function drawPriceLabel(ctx: CanvasRenderingContext2D, drawing: PriceLabelDrawing) {
  const anchorPoint = drawing.point;
  if (!anchorPoint) return;
  const anchor = logicalToPixel(anchorPoint);
  if (!anchor) return;
  const padding = 6;
  const height = 24;
  ctx.save();
  ctx.font = "12px Inter, sans-serif";
  const width = Math.max(40, ctx.measureText(drawing.text).width + padding * 2);
  if (drawing.background) {
    ctx.fillStyle = rgbaColor(drawing.background.color, drawing.background.opacity ?? 0.2);
    ctx.fillRect(anchor.x, anchor.y - height, width, height);
  }
  ctx.fillStyle = drawing.textColor;
  ctx.textBaseline = "middle";
  ctx.fillText(drawing.text, anchor.x + padding, anchor.y - height / 2);
  ctx.restore();
}

function drawCallout(ctx: CanvasRenderingContext2D, drawing: CalloutDrawing) {
  const anchorPoint = drawing.point;
  if (!anchorPoint) return;
  const anchor = logicalToPixel(anchorPoint);
  if (!anchor) return;
  const padding = 6;
  const height = 28;
  ctx.save();
  ctx.font = "12px Inter, sans-serif";
  const width = Math.max(60, ctx.measureText(drawing.text || "Note").width + padding * 2);
  if (drawing.background) {
    ctx.fillStyle = rgbaColor(drawing.background.color, drawing.background.opacity ?? 0.2);
    ctx.fillRect(anchor.x, anchor.y - height, width, height);
    ctx.beginPath();
    ctx.moveTo(anchor.x + width / 2 - 6, anchor.y);
    ctx.lineTo(anchor.x + width / 2, anchor.y + 6);
    ctx.lineTo(anchor.x + width / 2 + 6, anchor.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = drawing.textColor;
  ctx.textBaseline = "middle";
  ctx.fillText(drawing.text || "Note", anchor.x + padding, anchor.y - height / 2);
  ctx.restore();
}

function drawIcon(ctx: CanvasRenderingContext2D, drawing: IconDrawing) {
  const anchorPoint = drawing.point;
  if (!anchorPoint) return;
  const anchor = logicalToPixel(anchorPoint);
  if (!anchor) return;
  ctx.save();
  ctx.font = `${drawing.size ?? 14}px Inter, sans-serif`;
  ctx.fillStyle = drawing.color ?? "#fbbf24";
  ctx.fillText(drawing.icon || "★", anchor.x, anchor.y);
  ctx.restore();
}

function drawDraft(
  ctx: CanvasRenderingContext2D,
  toolId: DrawingToolId,
  points: LogicalPoint[]
) {
  const style = drawingStore.getToolStyle(toolId);
  const stroke: StrokeStyle = {
    color: style.strokeColor,
    width: style.strokeWidth,
    style: style.strokeStyle ?? "solid",
  };
  const dummyDrawing = {
    id: "__draft__",
    type: toolId,
    points,
    stroke,
    fill: style.fillColor
      ? { color: style.fillColor, opacity: style.fillOpacity ?? 0.2 }
      : undefined,
  } as DrawingShape;
  drawShape(ctx, dummyDrawing);
}

function drawHandles(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  ctx.save();
  ctx.fillStyle = "#38bdf8";
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function setStrokeStyle(ctx: CanvasRenderingContext2D, stroke: StrokeStyle) {
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  switch (stroke.style) {
    case "dashed":
      ctx.setLineDash([8, 4]);
      break;
    case "dotted":
      ctx.setLineDash([2, 4]);
      break;
    default:
      ctx.setLineDash([]);
  }
}

function rgbaColor(color: string, opacity: number) {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function drawingHasPoints(
  drawing: DrawingShape
): drawing is DrawingShape & { points: LogicalPoint[] } {
  return "points" in drawing;
}
</script>

<template>
  <div
    ref="overlayRef"
    class="absolute inset-0"
    :class="[
      drawingStore.activeTool !== 'cursor' && isActive ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-auto',
    ]"
  >
    <canvas ref="canvasRef" class="w-full h-full pointer-events-none"></canvas>
  </div>
</template>
