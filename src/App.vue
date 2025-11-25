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
