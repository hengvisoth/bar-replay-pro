<script setup lang="ts">
import { computed } from "vue";
import {
  useDrawingStore,
  type DrawingTool,
} from "../stores/drawingStore";

const drawingStore = useDrawingStore();

const tools: Array<{ id: DrawingTool; label: string }> = [
  { id: "cursor", label: "Cursor" },
  { id: "line", label: "Trend" },
  { id: "box", label: "Box" },
  { id: "text", label: "Text" },
];

const colorValue = computed(
  () => drawingStore.selectedDrawing?.color ?? drawingStore.activeColor
);

function selectTool(tool: DrawingTool) {
  drawingStore.setSelectedTool(tool);
}

function handleColorChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input?.value) return;
  drawingStore.setActiveColor(input.value);
  if (drawingStore.selectedDrawing) {
    drawingStore.updateDrawing(drawingStore.selectedDrawing.id, {
      color: input.value,
    });
  }
}

function clearAll() {
  drawingStore.clearAll();
}
</script>

<template>
  <div
    class="absolute right-3 top-16 z-30 bg-[#10141f]/90 border border-gray-700 rounded-xl shadow-lg backdrop-blur px-3 py-4 flex flex-col gap-3 w-32"
  >
    <div class="text-[11px] uppercase tracking-wider text-gray-400">
      Drawing Tools
    </div>
    <div class="flex flex-col gap-2">
      <button
        v-for="tool in tools"
        :key="tool.id"
        type="button"
        class="text-xs font-semibold px-3 py-1.5 rounded border transition-colors"
        :class="
          drawingStore.selectedTool === tool.id
            ? 'bg-blue-600/80 text-white border-blue-500 shadow-inner'
            : 'text-gray-300 border-gray-700 hover:border-blue-400'
        "
        @click="selectTool(tool.id)"
      >
        {{ tool.label }}
      </button>
    </div>

    <label class="flex flex-col text-[11px] uppercase text-gray-400 gap-1">
      Color
      <input
        type="color"
        class="h-9 rounded cursor-pointer"
        :value="colorValue"
        @input="handleColorChange"
      />
    </label>

    <button
      type="button"
      class="text-xs font-semibold px-3 py-1.5 rounded border border-red-500/60 text-red-300 hover:bg-red-500/10 transition-colors"
      @click="clearAll"
    >
      Clear All
    </button>
  </div>
</template>
