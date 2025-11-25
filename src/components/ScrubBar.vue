<script setup lang="ts">
import { useReplayStore } from "../stores/replayStore";

const store = useReplayStore();

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  store.jumpTo(parseInt(target.value));
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
        :max="store.allCandles.length - 1"
        :value="store.currentIndex"
        @input="onInput"
        class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400"
      />
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
  background: #3b82f6; /* Blue-500 */
  margin-top: -4px;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
}
</style>
