<script setup lang="ts">
import type { Timeframe } from "../data/types";
import { useReplayStore } from "../stores/replayStore";

const store = useReplayStore();

function selectTimeframe(tf: Timeframe) {
  store.setActiveTimeframe(tf);
}
</script>

<template>
  <div
    class="flex items-center gap-1 rounded border border-gray-800 bg-[#0f172a]/70 px-1 py-1 shadow-inner"
  >
    <button
      v-for="tf in store.availableTimeframes"
      :key="tf"
      type="button"
      class="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded transition-colors"
      :class="[
        store.activeTimeframe === tf
          ? 'bg-blue-600 text-white shadow shadow-blue-500/40'
          : 'text-gray-400 hover:text-white hover:bg-blue-500/10',
      ]"
      @click="selectTimeframe(tf)"
    >
      {{ tf }}
    </button>
  </div>
</template>
