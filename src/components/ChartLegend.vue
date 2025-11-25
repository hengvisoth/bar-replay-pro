<script setup lang="ts">
import type { Candle } from "../data/types";

const props = defineProps<{
  candle: Candle | null;
  symbol: string;
  interval: string;
  indicators?: Array<{ label: string; value: number | null; color: string }>;
}>();

// Helper to format price
const fmt = (n: number) => n?.toFixed(2);
// Helper to decide color (Green if Close > Open)
const getColor = (c: Candle) =>
  c.close >= c.open ? "text-[#26a69a]" : "text-[#ef5350]";
</script>

<template>
  <div
    class="absolute top-3 left-3 z-20 font-mono text-xs pointer-events-none select-none flex flex-wrap gap-x-3 bg-[#10141f]/50 p-1 rounded backdrop-blur-sm"
  >
    <!-- Symbol Info -->
    <span class="font-bold text-white text-sm">{{ symbol }}</span>
    <span class="text-gray-400 text-sm">{{ interval }}</span>

    <!-- OHLC Values -->
    <div v-if="candle" class="flex gap-3" :class="getColor(candle)">
      <span
        >O<span class="text-white ml-1">{{ fmt(candle.open) }}</span></span
      >
      <span
        >H<span class="text-white ml-1">{{ fmt(candle.high) }}</span></span
      >
      <span
        >L<span class="text-white ml-1">{{ fmt(candle.low) }}</span></span
      >
      <span
        >C<span class="text-white ml-1">{{ fmt(candle.close) }}</span></span
      >

      <!-- Vol (Optional) -->
      <span v-if="candle.volume"
        >Vol<span class="text-gray-400 ml-1"
          >{{ (candle.volume / 1000).toFixed(1) }}K</span
        ></span
      >
    </div>

    <div v-else class="text-gray-500 italic">Loading data...</div>

    <div
      v-if="props.indicators && props.indicators.length"
      class="flex flex-col gap-1 text-[11px] text-gray-300"
    >
      <div
        v-for="indicator in props.indicators"
        :key="indicator.label"
        class="flex items-center gap-2"
      >
        <span
          class="font-semibold"
          :style="{ color: indicator.color }"
          >{{ indicator.label }}</span
        >
        <span class="text-white">{{ fmt(indicator.value ?? 0) }}</span>
      </div>
    </div>
  </div>
</template>
