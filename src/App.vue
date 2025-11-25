<script setup lang="ts">
import ChartContainer from "./components/ChartContainer.vue";
import ScrubBar from "./components/ScrubBar.vue";
import TimeframeTabs from "./components/TimeframeTabs.vue";
import { useReplayStore } from "./stores/replayStore";

const store = useReplayStore();
</script>

<template>
  <div class="flex flex-col w-screen h-screen bg-[#10141f] overflow-hidden">
    <!-- Main Chart Area -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <div
        class="flex items-center gap-4 border-b border-gray-800 bg-[#0b111e] px-4 py-3"
      >
        <div class="text-[11px] uppercase tracking-[0.3em] text-gray-500">
          Timeframes
        </div>
        <TimeframeTabs />

        <div class="ml-auto flex items-center gap-3">
          <span class="text-[11px] uppercase tracking-[0.25em] text-gray-500"
            >Indicators</span
          >
          <div class="flex flex-wrap gap-2">
            <button
              v-for="indicator in store.indicatorDefinitions"
              :key="indicator.id"
              type="button"
              class="px-3 py-1 text-xs font-semibold rounded border transition-colors"
              :class="[
                store.isIndicatorActive(indicator.id)
                  ? 'border-blue-500 bg-blue-500/20 text-blue-100'
                  : 'border-gray-700 text-gray-400 hover:border-blue-500 hover:text-blue-100'
              ]"
              @click="store.toggleIndicator(indicator.id)"
            >
              {{ indicator.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="flex-1 relative">
        <ChartContainer :timeframe="store.activeTimeframe" />
      </div>
    </div>

    <!-- Scrub Bar at Bottom -->
    <div class="flex-none">
      <ScrubBar />
    </div>
  </div>
</template>
