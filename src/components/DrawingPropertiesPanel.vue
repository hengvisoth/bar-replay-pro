<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useDrawingStore, TOOL_DEFINITIONS } from "../stores/drawingStore";
import type {
  DrawingShape,
  LineStyleType,
  StrokeStyle,
  FillStyle,
} from "../data/drawings";

const drawingStore = useDrawingStore();
const drawing = computed(() => drawingStore.selectedDrawing);

const activeToolDefinition = computed(() =>
  TOOL_DEFINITIONS.find((tool) => tool.id === drawing.value?.type)
);

const supportsFill = computed(() => drawingHasFill(drawing.value));

const supportsText = computed(() =>
  drawing.value ? ["text", "price-label", "callout"].includes(drawing.value.type) : false
);
const strokeSettings = computed(() =>
  drawingHasStroke(drawing.value) ? drawing.value.stroke : null
);
const fillSettings = computed(() =>
  drawingHasFill(drawing.value) ? drawing.value.fill : null
);

const strokeColor = ref("#0ea5e9");
const fillColor = ref("#0ea5e9");
const textValue = ref("");

watchDrawing();

function watchDrawing() {
  watchEffect(() => {
    const current = drawing.value;
    if (!current) return;
    if (drawingHasStroke(current)) {
      strokeColor.value = current.stroke.color;
    }
    if (drawingHasFill(current) && current.fill?.color) {
      fillColor.value = current.fill.color;
    }
    if (supportsText.value) {
      textValue.value = (current as DrawingShape & { text?: string }).text ?? "";
    }
  });
}

function updateDrawing(updates: Partial<DrawingShape>) {
  if (!drawing.value) return;
  drawingStore.updateDrawing(drawing.value.id, updates, { recordHistory: false });
}

function handleStrokeColorChange(event: Event) {
  if (!drawingHasStroke(drawing.value)) return;
  const input = event.target as HTMLInputElement;
  strokeColor.value = input.value;
  updateDrawing({
    stroke: { ...drawing.value.stroke, color: input.value },
  });
}

function handleStrokeWidthChange(event: Event) {
  if (!drawingHasStroke(drawing.value)) return;
  const input = event.target as HTMLInputElement;
  const width = Number(input.value);
  updateDrawing({
    stroke: {
      ...drawing.value.stroke,
      width,
    },
  });
}

function handleStrokeStyleChange(event: Event) {
  if (!drawingHasStroke(drawing.value)) return;
  const select = event.target as HTMLSelectElement;
  updateDrawing({
    stroke: {
      ...drawing.value.stroke,
      style: select.value as LineStyleType,
    },
  });
}

function handleFillColorChange(event: Event) {
  const current = drawing.value;
  if (!drawingHasFill(current)) return;
  const input = event.target as HTMLInputElement;
  fillColor.value = input.value;
  updateDrawing({
    fill: {
      ...(current.fill ?? { opacity: 0.2, color: fillColor.value }),
      color: input.value,
    },
  });
}

function handleFillOpacityChange(event: Event) {
  const current = drawing.value;
  if (!drawingHasFill(current)) return;
  const input = event.target as HTMLInputElement;
  const opacity = Number(input.value);
  updateDrawing({
    fill: {
      ...(current.fill ?? { color: fillColor.value, opacity }),
      opacity,
    },
  });
}

function handleTextChange(event: Event) {
  if (!drawing.value) return;
  const textarea = event.target as HTMLTextAreaElement;
  textValue.value = textarea.value;
  updateDrawing({ text: textarea.value } as Partial<DrawingShape>);
}

function toggleLock() {
  if (!drawing.value) return;
  updateDrawing({ locked: !drawing.value.locked });
}

function toggleVisibility() {
  if (!drawing.value) return;
  updateDrawing({ hidden: !drawing.value.hidden });
}

function deleteDrawing() {
  if (!drawing.value) return;
  drawingStore.removeDrawing(drawing.value.id);
}

function saveTemplate() {
  if (!drawing.value) return;
  drawingStore.saveTemplate(`Template ${new Date().toLocaleTimeString()}`);
}

function drawingHasStroke(value: DrawingShape | null): value is DrawingShape & {
  stroke: StrokeStyle;
} {
  if (!value) return false;
  return "stroke" in value && !!(value as DrawingShape & { stroke?: StrokeStyle }).stroke;
}

function drawingHasFill(value: DrawingShape | null): value is DrawingShape & {
  fill?: FillStyle;
} {
  if (!value) return false;
  return "fill" in value;
}
</script>

<template>
  <div
    v-if="drawing"
    class="absolute top-4 right-4 w-72 bg-[#050505]/90 border border-gray-700 rounded-xl shadow-2xl p-4 text-xs text-gray-200 space-y-3 backdrop-blur"
  >
    <div class="flex items-center justify-between">
      <div>
        <p class="text-[11px] uppercase tracking-wider text-gray-400">Selected Tool</p>
        <p class="text-sm font-semibold">{{ activeToolDefinition?.label }}</p>
      </div>
      <div class="flex gap-2">
        <button
          class="px-2 py-1 rounded border border-gray-600 text-[11px] hover:bg-gray-700/60"
          @click="toggleLock"
        >
          {{ drawing.locked ? "Unlock" : "Lock" }}
        </button>
        <button
          class="px-2 py-1 rounded border border-gray-600 text-[11px] hover:bg-gray-700/60"
          @click="toggleVisibility"
        >
          {{ drawing.hidden ? "Show" : "Hide" }}
        </button>
      </div>
    </div>

    <div v-if="drawing && drawingHasStroke(drawing)" class="space-y-2">
      <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-wider text-gray-500">Stroke Color</span>
        <input type="color" :value="strokeColor" @input="handleStrokeColorChange" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-wider text-gray-500">Stroke Width</span>
        <input type="range" min="1" max="10" :value="strokeSettings?.width ?? 2" @input="handleStrokeWidthChange" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-wider text-gray-500">Line Style</span>
        <select
          class="bg-gray-900 border border-gray-700 rounded px-2 py-1"
          :value="strokeSettings?.style ?? 'solid'"
          @change="handleStrokeStyleChange"
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
    </div>

    <div v-if="supportsFill" class="space-y-2">
      <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-wider text-gray-500">Fill Color</span>
        <input type="color" :value="fillColor" @input="handleFillColorChange" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-wider text-gray-500">Fill Opacity</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="fillSettings?.opacity ?? 0.2"
          @input="handleFillOpacityChange"
        />
      </label>
    </div>

    <div v-if="supportsText" class="space-y-2">
      <label class="flex flex-col gap-1">
        <span class="text-[11px] uppercase tracking-wider text-gray-500">Text</span>
        <textarea
          rows="3"
          class="bg-gray-900 border border-gray-700 rounded px-2 py-1 resize-none"
          :value="textValue"
          @input="handleTextChange"
        ></textarea>
      </label>
    </div>

    <div class="flex items-center justify-between">
      <button
        class="px-3 py-1.5 rounded border border-gray-600 text-[11px] hover:bg-gray-800/60"
        @click="saveTemplate"
      >
        Save Template
      </button>
      <button
        class="px-3 py-1.5 rounded border border-red-500 text-[11px] text-red-200 hover:bg-red-500/10"
        @click="deleteDrawing"
      >
        Delete
      </button>
    </div>
  </div>
</template>
