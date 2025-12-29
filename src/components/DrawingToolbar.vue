<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TOOL_DEFINITIONS, useDrawingStore } from "../stores/drawingStore";

const drawingStore = useDrawingStore();
const strokeColor = ref("#0ea5e9");
const fillColor = ref("#0ea5e9");
const strokeWidth = ref(2);

const activeToolStyle = computed(() =>
  drawingStore.getToolStyle(drawingStore.activeTool)
);

watch(
  activeToolStyle,
  (style) => {
    strokeColor.value = style.strokeColor;
    strokeWidth.value = style.strokeWidth;
    fillColor.value = style.fillColor ?? strokeColor.value;
  },
  { immediate: true, deep: true }
);

const magnetOptions: Array<{
  label: string;
  value: "off" | "weak" | "strong";
}> = [
  { label: "Off", value: "off" },
  { label: "Weak", value: "weak" },
  { label: "Strong", value: "strong" },
];

function selectTool(toolId: string) {
  drawingStore.setSelectedTool(toolId as never);
}

function toggleFavorite(event: Event, toolId: string) {
  event.stopPropagation();
  drawingStore.toggleFavorite(toolId as never);
}

function toggleToolbar() {
  drawingStore.setToolbarVisibility(!drawingStore.toolbarVisible);
}

function handleStrokeColorChange(event: Event) {
  const input = event.target as HTMLInputElement;
  strokeColor.value = input.value;
  drawingStore.updateToolStyle(drawingStore.activeTool, {
    strokeColor: input.value,
  });
}

function handleStrokeWidthChange(event: Event) {
  const input = event.target as HTMLInputElement;
  strokeWidth.value = Number(input.value);
  drawingStore.updateToolStyle(drawingStore.activeTool, {
    strokeWidth: strokeWidth.value,
  });
}

function handleFillColorChange(event: Event) {
  const input = event.target as HTMLInputElement;
  fillColor.value = input.value;
  drawingStore.updateToolStyle(drawingStore.activeTool, {
    fillColor: fillColor.value,
  });
}

function handleImport() {
  const raw = window.prompt("Paste drawing JSON to import");
  if (!raw) return;
  drawingStore.importFromJson(raw);
}

async function handleExport() {
  const payload = drawingStore.exportCurrent();
  if (!payload) return;
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(payload);
    window.alert("Current drawings copied to clipboard");
  } else {
    window.prompt("Copy drawings JSON", payload);
  }
}

function handleMagnetChange(event: Event) {
  const select = event.target as HTMLSelectElement;
  drawingStore.setMagnet(select.value as never);
}

function applyTemplate(templateId: string) {
  drawingStore.applyTemplate(templateId);
}

function removeTemplate(templateId: string) {
  drawingStore.deleteTemplate(templateId);
}
</script>

<template>
  <div class="absolute left-3 top-20 z-30 flex flex-col gap-3">
    <div
      v-if="drawingStore.favoriteTools.length"
      class="flex gap-1 px-2 py-1 bg-[#050505]/80 border border-gray-700 rounded-full shadow pointer-events-auto"
    >
      <button
        v-for="tool in drawingStore.favoriteTools"
        :key="tool.id"
        class="px-2 py-1 text-xs font-semibold rounded-full"
        :class="[
          drawingStore.activeTool === tool.id
            ? 'bg-blue-600/80 text-white'
            : 'text-gray-300 hover:bg-gray-800/80',
        ]"
        @click="selectTool(tool.id)"
      >
        {{ tool.icon }}
      </button>
    </div>

    <div
      v-if="drawingStore.toolbarVisible"
      class="w-64 bg-[#050505]/90 border border-gray-800 rounded-2xl shadow-2xl backdrop-blur p-4 text-xs text-gray-200 space-y-4 pointer-events-auto"
    >
      <div class="flex items-center justify-between">
        <div>
          <p class="text-[11px] uppercase tracking-[0.3em] text-gray-500">
            Tools
          </p>
          <p class="text-sm font-semibold text-white">Drawing Toolbar</p>
        </div>
        <button class="text-gray-400 hover:text-white" @click="toggleToolbar">
          Hide
        </button>
      </div>

      <div class="flex items-center gap-2">
        <label class="text-[11px] uppercase tracking-wider text-gray-500"
          >Magnet</label
        >
        <select
          class="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
          :value="drawingStore.magnetMode"
          @change="handleMagnetChange"
        >
          <option
            v-for="option in magnetOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="tool in TOOL_DEFINITIONS"
          :key="tool.id"
          :class="[
            'flex items-center justify-between px-3 py-2 rounded border text-xs font-semibold transition-colors cursor-pointer',
            drawingStore.activeTool === tool.id
              ? 'bg-blue-600/80 border-blue-500 text-white'
              : 'border-gray-700 text-gray-200 hover:border-blue-500/70',
          ]"
          @click="selectTool(tool.id)"
        >
          <span class="flex items-center gap-2">
            <span class="text-base">{{ tool.icon }}</span>
            <span>{{ tool.label }}</span>
          </span>
          <button
            type="button"
            class="text-[13px]"
            :class="
              drawingStore.favorites.has(tool.id)
                ? 'text-yellow-400'
                : 'text-gray-500'
            "
            @click="(event) => toggleFavorite(event, tool.id)"
          >
            ★
          </button>
        </div>
      </div>

      <div class="border rounded-xl border-gray-800 p-3 space-y-2">
        <p class="text-[11px] uppercase tracking-wider text-gray-500">
          Defaults
        </p>
        <label class="flex flex-col gap-1">
          <span>Stroke Color</span>
          <input
            type="color"
            :value="strokeColor"
            @input="handleStrokeColorChange"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span>Stroke Width</span>
          <input
            type="range"
            min="1"
            max="10"
            :value="strokeWidth"
            @input="handleStrokeWidthChange"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span>Fill Color</span>
          <input
            type="color"
            :value="fillColor"
            @input="handleFillColorChange"
          />
        </label>
      </div>

      <div class="flex flex-wrap gap-2 text-[11px]">
        <button
          class="flex-1 px-3 py-1.5 rounded border border-red-500/60 text-red-200 hover:bg-red-500/10"
          @click="drawingStore.clearAll"
        >
          Clear All
        </button>
        <button
          class="flex-1 px-3 py-1.5 rounded border border-gray-600 hover:bg-gray-700/50"
          @click="drawingStore.toggleShowAll"
        >
          {{ drawingStore.showAll ? "Hide All" : "Show All" }}
        </button>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class="flex-1 px-3 py-1.5 rounded border border-gray-600 hover:bg-gray-700/50"
          @click="handleImport"
        >
          Import
        </button>
        <button
          class="flex-1 px-3 py-1.5 rounded border border-gray-600 hover:bg-gray-700/50"
          @click="handleExport"
        >
          Export
        </button>
      </div>

      <div v-if="drawingStore.templates.length" class="space-y-2">
        <p class="text-[11px] uppercase tracking-wider text-gray-500">
          Templates
        </p>
        <div class="flex flex-col gap-2">
          <div
            v-for="template in drawingStore.templates"
            :key="template.id"
            class="flex items-center justify-between bg-gray-900/70 border border-gray-700 rounded px-3 py-1.5"
          >
            <span class="text-xs font-semibold">{{ template.name }}</span>
            <div class="flex gap-2">
              <button
                class="text-blue-300 hover:text-white"
                @click="applyTemplate(template.id)"
              >
                Apply
              </button>
              <button
                class="text-red-300 hover:text-red-200"
                @click="removeTemplate(template.id)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <button
      v-else
      class="px-3 py-1.5 rounded-full border border-gray-600 bg-[#050505]/80 text-gray-200 text-xs pointer-events-auto"
      @click="toggleToolbar"
    >
      Show Drawing Tools
    </button>
  </div>
</template>
