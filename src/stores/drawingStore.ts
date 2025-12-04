import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type DrawingTool = "cursor" | "line" | "box" | "text";
export type DrawingType = Exclude<DrawingTool, "cursor">;

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  color: string;
  lineWidth: number;
  text?: string;
  points: DrawingPoint[];
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `drawing-${Date.now()}-${idCounter}`;
}

export const useDrawingStore = defineStore("drawing", () => {
  const drawings = ref<Drawing[]>([]);
  const selectedTool = ref<DrawingTool>("cursor");
  const selectedDrawingId = ref<string | null>(null);
  const activeColor = ref("#ffb703");
  const defaultLineWidth = ref(2);

  const selectedDrawing = computed(() =>
    drawings.value.find((drawing) => drawing.id === selectedDrawingId.value) ||
    null
  );

  function addDrawing(payload: Omit<Drawing, "id">) {
    drawings.value = [
      ...drawings.value,
      {
        ...payload,
        id: nextId(),
      },
    ];
  }

  function removeDrawing(id: string) {
    drawings.value = drawings.value.filter((drawing) => drawing.id !== id);
    if (selectedDrawingId.value === id) {
      selectedDrawingId.value = null;
    }
  }

  function updateDrawing(id: string, updates: Partial<Omit<Drawing, "id">>) {
    drawings.value = drawings.value.map((drawing) =>
      drawing.id === id ? { ...drawing, ...updates } : drawing
    );
  }

  function setSelectedTool(tool: DrawingTool) {
    selectedTool.value = tool;
    if (tool !== "cursor") {
      selectedDrawingId.value = null;
    }
  }

  function setSelectedDrawing(id: string | null) {
    selectedDrawingId.value = id;
    if (id !== null) {
      selectedTool.value = "cursor";
    }
  }

  function setActiveColor(color: string) {
    activeColor.value = color;
  }

  function clearAll() {
    drawings.value = [];
    selectedDrawingId.value = null;
  }

  return {
    drawings,
    selectedTool,
    selectedDrawingId,
    selectedDrawing,
    activeColor,
    defaultLineWidth,
    addDrawing,
    removeDrawing,
    updateDrawing,
    setSelectedTool,
    setSelectedDrawing,
    setActiveColor,
    clearAll,
  };
});
