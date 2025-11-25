<script setup lang="ts">
import { useReplayStore } from "../stores/replayStore";

const store = useReplayStore();

const speedPresets = [
  { label: "0.5x", interval: 2000 },
  { label: "1x", interval: 1000 },
  { label: "2x", interval: 500 },
  { label: "5x", interval: 200 },
  { label: "10x", interval: 100 },
];

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  store.jumpTo(parseInt(target.value));
}

function setSpeed(interval: number) {
  store.setPlaybackInterval(interval);
}
</script>

<template>
  <div
    class="w-full h-14 bg-[#10141f] border-t border-gray-800 flex items-center px-4 gap-4 z-30"
  >
    <button
      @click="store.togglePlay"
      class="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0"
    >
      <span v-if="!store.isPlaying">▶</span>
      <span v-else>⏸</span>
    </button>

    <div class="flex-1 flex flex-col justify-center">
      <input
        type="range"
        min="0"
        :max="Math.max(store.totalCandles - 1, 0)"
        :value="store.masterIndex"
        @input="onInput"
        class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400"
      />
    </div>

    <div class="flex items-center gap-2 text-[11px] text-gray-400">
      <span>Speed</span>
      <div class="flex gap-1">
        <button
          v-for="preset in speedPresets"
          :key="preset.label"
          class="px-2 py-1 rounded border text-xs"
          :class="[
            store.playbackSpeed === preset.interval
              ? 'border-blue-500 text-blue-100'
              : 'border-gray-600 text-gray-400 hover:border-blue-500 hover:text-blue-100',
          ]"
          @click="setSpeed(preset.interval)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <div
      class="flex flex-col items-end w-40 shrink-0 border-l border-gray-700 pl-4"
    >
      <span class="text-[10px] text-gray-500 uppercase font-bold tracking-wider"
        >Current Time</span
      >
      <span class="text-sm font-mono text-gray-200 truncate">
        {{ store.currentDate || "Loading..." }}
      </span>
    </div>
  </div>
</template>

<style scoped>
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 16px;
  width: 16px;
  border-radius: 50%;
  background: #3b82f6;
  margin-top: -4px;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
}
</style>
