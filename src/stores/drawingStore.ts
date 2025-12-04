import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import type {
  DrawingShape,
  DrawingTemplate,
  DrawingToolDefinition,
  DrawingToolId,
  DrawingPaneTarget,
  LineStyleType,
} from "../data/drawings";

type MagnetMode = "off" | "weak" | "strong";

interface PersistedDrawingState {
  drawings: Record<string, DrawingShape[]>;
  favorites: DrawingToolId[];
  templates: DrawingTemplate[];
  magnetMode: MagnetMode;
  toolbarVisible: boolean;
  showAll: boolean;
  toolStyles: Record<DrawingToolId, ToolStyleDefaults>;
}

interface UndoEntry {
  key: string;
  drawings: DrawingShape[];
}

const STORAGE_KEY = "bar-replay-pro:drawing-state:v2";
const TOOLBAR_STATE_KEY = "bar-replay-pro:drawing-toolbar:v1";
const MAX_UNDO = 50;

export interface ToolStyleDefaults {
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: LineStyleType;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  fontSize?: number;
  backgroundColor?: string;
}

const DEFAULT_TOOL_STYLES: Record<DrawingToolId, ToolStyleDefaults> = {
  cursor: { strokeColor: "#ffffff", strokeWidth: 1, strokeStyle: "solid" },
  "trend-line": { strokeColor: "#0ea5e9", strokeWidth: 2, strokeStyle: "solid" },
  ray: { strokeColor: "#f97316", strokeWidth: 2, strokeStyle: "solid" },
  rectangle: {
    strokeColor: "#34d399",
    strokeWidth: 2,
    strokeStyle: "solid",
    fillColor: "#34d399",
    fillOpacity: 0.15,
  },
  "parallel-channel": {
    strokeColor: "#c084fc",
    strokeWidth: 2,
    strokeStyle: "dashed",
    fillColor: "#c084fc",
    fillOpacity: 0.12,
  },
  triangle: {
    strokeColor: "#f472b6",
    strokeWidth: 2,
    strokeStyle: "solid",
    fillColor: "#f472b6",
    fillOpacity: 0.18,
  },
  brush: { strokeColor: "#facc15", strokeWidth: 2, strokeStyle: "solid" },
  text: {
    strokeColor: "#93c5fd",
    strokeWidth: 1,
    strokeStyle: "solid",
    textColor: "#f1f5f9",
    fontSize: 12,
    backgroundColor: "#1e293b",
  },
  "horizontal-line": {
    strokeColor: "#fde047",
    strokeWidth: 2,
    strokeStyle: "dashed",
  },
  "vertical-line": {
    strokeColor: "#a855f7",
    strokeWidth: 2,
    strokeStyle: "dotted",
  },
  "price-label": {
    strokeColor: "#0ea5e9",
    strokeWidth: 1,
    strokeStyle: "solid",
    fillColor: "#0ea5e9",
    fillOpacity: 0.2,
    textColor: "#e2e8f0",
  },
  callout: {
    strokeColor: "#fb7185",
    strokeWidth: 2,
    strokeStyle: "solid",
    fillColor: "#fb7185",
    fillOpacity: 0.18,
    textColor: "#0f172a",
    backgroundColor: "#ffffff",
  },
  icon: {
    strokeColor: "#fbbf24",
    strokeWidth: 1,
    strokeStyle: "solid",
    textColor: "#fbbf24",
  },
};
export const TOOL_DEFINITIONS: DrawingToolDefinition[] = [
  {
    id: "cursor",
    label: "Cursor",
    icon: "⌶",
    kind: "single-point",
    minPoints: 0,
    maxPoints: 0,
    paneTarget: "main",
    supportsFill: false,
  },
  {
    id: "trend-line",
    label: "Trend Line",
    icon: "／",
    kind: "multi-point",
    minPoints: 2,
    maxPoints: 2,
    paneTarget: "main",
    supportsFill: false,
  },
  {
    id: "ray",
    label: "Ray",
    icon: "↗",
    kind: "multi-point",
    minPoints: 2,
    maxPoints: 2,
    paneTarget: "main",
    supportsFill: false,
  },
  {
    id: "rectangle",
    label: "Rectangle",
    icon: "▭",
    kind: "multi-point",
    minPoints: 2,
    maxPoints: 2,
    paneTarget: "main",
    supportsFill: true,
  },
  {
    id: "parallel-channel",
    label: "Parallel Channel",
    icon: "⧄",
    kind: "multi-point",
    minPoints: 3,
    maxPoints: 3,
    paneTarget: "main",
    supportsFill: true,
  },
  {
    id: "triangle",
    label: "Triangle",
    icon: "△",
    kind: "multi-point",
    minPoints: 3,
    maxPoints: 3,
    paneTarget: "main",
    supportsFill: true,
  },
  {
    id: "brush",
    label: "Brush",
    icon: "✎",
    kind: "freehand",
    minPoints: 2,
    maxPoints: 200,
    paneTarget: "main",
    supportsFill: false,
  },
  {
    id: "text",
    label: "Text",
    icon: "T",
    kind: "single-point",
    minPoints: 1,
    maxPoints: 1,
    paneTarget: "main",
    supportsFill: true,
    hasText: true,
  },
  {
    id: "horizontal-line",
    label: "Horizontal Line",
    icon: "═",
    kind: "single-point",
    minPoints: 1,
    maxPoints: 1,
    paneTarget: "main",
    supportsFill: false,
  },
  {
    id: "vertical-line",
    label: "Vertical Line",
    icon: "║",
    kind: "single-point",
    minPoints: 1,
    maxPoints: 1,
    paneTarget: "main",
    supportsFill: false,
  },
  {
    id: "price-label",
    label: "Price Label",
    icon: "$",
    kind: "single-point",
    minPoints: 1,
    maxPoints: 1,
    paneTarget: "main",
    supportsFill: true,
    hasText: true,
  },
  {
    id: "callout",
    label: "Callout",
    icon: "💬",
    kind: "single-point",
    minPoints: 1,
    maxPoints: 1,
    paneTarget: "main",
    supportsFill: true,
    hasText: true,
  },
  {
    id: "icon",
    label: "Icon",
    icon: "★",
    kind: "single-point",
    minPoints: 1,
    maxPoints: 1,
    paneTarget: "main",
    supportsFill: false,
  },
];

function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto.randomUUID as () => string)();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export const useDrawingStore = defineStore("drawing", () => {
  const activeSymbol = ref<string | null>(null);
  const activeTimeframe = ref<string | null>(null);
  const drawingsByKey = ref<Record<string, DrawingShape[]>>({});
  const favorites = ref<Set<DrawingToolId>>(new Set());
  const templates = ref<DrawingTemplate[]>([]);
  const activeTool = ref<DrawingToolId>("cursor");
  const selectedDrawingId = ref<string | null>(null);
  const hoveredDrawingId = ref<string | null>(null);
  const magnetMode = ref<MagnetMode>("weak");
  const toolbarVisible = ref(true);
  const toolbarPinned = ref(true);
  const showAll = ref(true);
  const selectedPane = ref<DrawingPaneTarget>("main");
  const undoStack = ref<UndoEntry[]>([]);
  const redoStack = ref<UndoEntry[]>([]);
  const lastExport = ref<string | null>(null);
  const toolStyles = ref<Record<DrawingToolId, ToolStyleDefaults>>(
    clone(DEFAULT_TOOL_STYLES)
  );

  loadPersistedState();

  const currentKey = computed(() => {
    if (!activeSymbol.value || !activeTimeframe.value) return null;
    return `${activeSymbol.value}__${activeTimeframe.value}`;
  });

  const currentDrawings = computed<DrawingShape[]>(() => {
    const key = currentKey.value;
    if (!key) return [];
    if (!drawingsByKey.value[key]) {
      drawingsByKey.value[key] = [];
    }
    return drawingsByKey.value[key];
  });

  const favoriteTools = computed(() =>
    TOOL_DEFINITIONS.filter((tool) => favorites.value.has(tool.id))
  );

  const visibleDrawings = computed(() => {
    if (!showAll.value) {
      return currentDrawings.value.map((drawing) => ({
        ...drawing,
        hidden: true,
      }));
    }
    return currentDrawings.value;
  });

  const selectedDrawing = computed(() =>
    currentDrawings.value.find((drawing) => drawing.id === selectedDrawingId.value) ||
    null
  );

  const activeToolDefinition = computed(
    () => TOOL_DEFINITIONS.find((tool) => tool.id === activeTool.value) ?? TOOL_DEFINITIONS[0]
  );

  watch(
    drawingsByKey,
    () => {
      persistState();
    },
    { deep: true }
  );
  watch(
    [favorites, templates, magnetMode, toolbarVisible, showAll, toolStyles],
    () => {
      persistState();
    },
    { deep: true }
  );

  function ensureKey(key: string) {
    if (!drawingsByKey.value[key]) {
      drawingsByKey.value[key] = reactive([]) as unknown as DrawingShape[];
    }
  }

  function setContext(symbol: string, timeframe: string) {
    activeSymbol.value = symbol;
    activeTimeframe.value = timeframe;
    const key = `${symbol}__${timeframe}`;
    ensureKey(key);
  }

  function pushUndoSnapshot() {
    const key = currentKey.value;
    if (!key) return;
    const snapshot = clone(currentDrawings.value);
    undoStack.value.push({ key, drawings: snapshot });
    if (undoStack.value.length > MAX_UNDO) {
      undoStack.value.shift();
    }
    redoStack.value = [];
  }

  function addDrawing(drawing: DrawingShape) {
    const key = currentKey.value;
    if (!key) return;
    pushUndoSnapshot();
    ensureKey(key);
    const items = drawingsByKey.value[key] ?? [];
    drawingsByKey.value[key] = [...items, drawing];
    selectedDrawingId.value = drawing.id;
  }

function updateDrawing(
  id: string,
  updates: Partial<DrawingShape>,
  options?: { recordHistory?: boolean }
) {
  const key = currentKey.value;
  if (!key) return;
  const items = drawingsByKey.value[key];
  if (!items) return;
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;
  if (options?.recordHistory !== false) {
    pushUndoSnapshot();
  }
  const updated = { ...items[index], ...updates, updatedAt: Date.now() };
  drawingsByKey.value[key] = [
    ...items.slice(0, index),
    updated as DrawingShape,
    ...items.slice(index + 1),
    ];
  }

function removeDrawing(id: string) {
  const key = currentKey.value;
  if (!key) return;
  pushUndoSnapshot();
  const items = drawingsByKey.value[key] ?? [];
  drawingsByKey.value[key] = items.filter(
    (drawing) => drawing.id !== id
  );
  if (selectedDrawingId.value === id) {
    selectedDrawingId.value = null;
  }
  }

function clearAll() {
  const key = currentKey.value;
  if (!key) return;
  const items = drawingsByKey.value[key];
  if (!items || !items.length) return;
  pushUndoSnapshot();
  drawingsByKey.value[key] = [];
  selectedDrawingId.value = null;
}

  function setSelectedTool(toolId: DrawingToolId) {
    activeTool.value = toolId;
    selectedPane.value =
      TOOL_DEFINITIONS.find((tool) => tool.id === toolId)?.paneTarget ?? "main";
  }

  function setSelectedDrawing(id: string | null) {
    selectedDrawingId.value = id;
  }

  function toggleFavorite(toolId: DrawingToolId) {
    const next = new Set(favorites.value);
    if (next.has(toolId)) {
      next.delete(toolId);
    } else {
      next.add(toolId);
    }
    favorites.value = next;
  }

  function setToolbarVisibility(value: boolean) {
    toolbarVisible.value = value;
  }

  function setToolbarPinned(value: boolean) {
    toolbarPinned.value = value;
    persistToolbarState();
  }

  function setMagnet(next: MagnetMode) {
    magnetMode.value = next;
  }

  function toggleShowAll() {
    showAll.value = !showAll.value;
  }

  function toggleLockSelected() {
    if (!selectedDrawing.value) return;
    updateDrawing(selectedDrawing.value.id, {
      locked: !selectedDrawing.value.locked,
    } as DrawingShape);
  }

  function toggleVisibilitySelected() {
    if (!selectedDrawing.value) return;
    updateDrawing(selectedDrawing.value.id, {
      hidden: !selectedDrawing.value.hidden,
    } as DrawingShape);
  }

  function undoLast() {
    const entry = undoStack.value.pop();
    if (!entry) return;
    const current = clone(drawingsByKey.value[entry.key] ?? []);
    redoStack.value.push({ key: entry.key, drawings: current });
    drawingsByKey.value[entry.key] = clone(entry.drawings);
  }

  function redoLast() {
    const entry = redoStack.value.pop();
    if (!entry) return;
    const current = clone(drawingsByKey.value[entry.key] ?? []);
    undoStack.value.push({ key: entry.key, drawings: current });
    drawingsByKey.value[entry.key] = clone(entry.drawings);
  }

  function exportCurrent(): string | null {
    const key = currentKey.value;
    if (!key) return null;
    const payload = {
      symbol: activeSymbol.value,
      timeframe: activeTimeframe.value,
      drawings: drawingsByKey.value[key],
    };
    const serialized = JSON.stringify(payload, null, 2);
    lastExport.value = serialized;
    return serialized;
  }

  function importFromJson(serialized: string) {
    try {
      const parsed = JSON.parse(serialized) as {
        drawings: DrawingShape[];
        symbol?: string;
        timeframe?: string;
      };
      const targetSymbol = parsed.symbol ?? activeSymbol.value;
      const targetTimeframe = parsed.timeframe ?? activeTimeframe.value;
      if (!targetSymbol || !targetTimeframe) return;
      const key = `${targetSymbol}__${targetTimeframe}`;
      ensureKey(key);
      pushUndoSnapshot();
      const existing = drawingsByKey.value[key] ?? [];
      drawingsByKey.value[key] = [
        ...existing,
        ...parsed.drawings.map((drawing) => ({
          ...drawing,
          id: randomId("drawing"),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
      ];
    } catch (error) {
      console.warn("Failed to import drawings", error);
    }
  }

  function getToolStyle(toolId: DrawingToolId) {
    return toolStyles.value[toolId] ?? DEFAULT_TOOL_STYLES[toolId];
  }

  function updateToolStyle(toolId: DrawingToolId, updates: Partial<ToolStyleDefaults>) {
    toolStyles.value = {
      ...toolStyles.value,
      [toolId]: { ...getToolStyle(toolId), ...updates },
    };
  }

  function saveTemplate(name: string, description?: string) {
    if (!currentDrawings.value.length) return;
    const template: DrawingTemplate = {
      id: randomId("template"),
      name,
      description,
      drawings: clone(currentDrawings.value),
    };
    templates.value = [...templates.value, template];
  }

  function deleteTemplate(id: string) {
    templates.value = templates.value.filter((template) => template.id !== id);
  }

  function applyTemplate(id: string) {
    const template = templates.value.find((entry) => entry.id === id);
    if (!template) return;
    const key = currentKey.value;
    if (!key) return;
    ensureKey(key);
    pushUndoSnapshot();
    const existing = drawingsByKey.value[key] ?? [];
    drawingsByKey.value[key] = [
      ...existing,
      ...clone(template.drawings).map((drawing) => ({
        ...drawing,
        id: randomId("drawing"),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
    ];
  }

  function setHoveredDrawing(id: string | null) {
    hoveredDrawingId.value = id;
  }

  function persistState() {
    if (typeof window === "undefined") return;
    const payload: PersistedDrawingState = {
      drawings: drawingsByKey.value,
      favorites: Array.from(favorites.value),
      templates: templates.value,
      magnetMode: magnetMode.value,
      toolbarVisible: toolbarVisible.value,
      showAll: showAll.value,
      toolStyles: toolStyles.value,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      persistToolbarState();
    } catch (error) {
      console.warn("Failed to persist drawing state", error);
    }
  }

  function captureSnapshot() {
    pushUndoSnapshot();
  }

  function persistToolbarState() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        TOOLBAR_STATE_KEY,
        JSON.stringify({
          toolbarPinned: toolbarPinned.value,
        })
      );
    } catch (error) {
      console.warn("Failed to persist toolbar state", error);
    }
  }

  function loadPersistedState() {
    if (typeof window === "undefined") return;
    const serialized = window.localStorage.getItem(STORAGE_KEY);
    if (serialized) {
      try {
        const parsed = JSON.parse(serialized) as PersistedDrawingState;
        drawingsByKey.value = parsed.drawings ?? {};
        favorites.value = new Set(parsed.favorites ?? []);
        templates.value = parsed.templates ?? [];
        magnetMode.value = parsed.magnetMode ?? "off";
        toolbarVisible.value = parsed.toolbarVisible ?? true;
        showAll.value = parsed.showAll ?? true;
        toolStyles.value = {
          ...clone(DEFAULT_TOOL_STYLES),
          ...(parsed.toolStyles ?? {}),
        };
      } catch (error) {
        console.warn("Failed to parse drawing storage", error);
      }
    }
    const toolbarState = window.localStorage.getItem(TOOLBAR_STATE_KEY);
    if (toolbarState) {
      try {
        const parsed = JSON.parse(toolbarState) as { toolbarPinned?: boolean };
        toolbarPinned.value = parsed.toolbarPinned ?? true;
      } catch {
        toolbarPinned.value = true;
      }
    }
  }

  return {
    activeTool,
    activeToolDefinition,
    favorites,
    favoriteTools,
    setContext,
    drawingsByKey,
    currentDrawings,
    visibleDrawings,
    selectedDrawingId,
    selectedDrawing,
    hoveredDrawingId,
    magnetMode,
    toolbarVisible,
    toolbarPinned,
    showAll,
    selectedPane,
    setSelectedTool,
    setSelectedDrawing,
    toggleFavorite,
    setToolbarVisibility,
    setToolbarPinned,
    setMagnet,
    toggleShowAll,
    toggleLockSelected,
    toggleVisibilitySelected,
    addDrawing,
    updateDrawing,
    removeDrawing,
    clearAll,
    undoLast,
    exportCurrent,
    importFromJson,
    saveTemplate,
    deleteTemplate,
    applyTemplate,
    templates,
    setHoveredDrawing,
    lastExport,
    captureSnapshot,
    redoLast,
    toolStyles,
    getToolStyle,
    updateToolStyle,
  };
});
