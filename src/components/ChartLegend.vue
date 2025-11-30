<script setup lang="ts">
import { ref } from "vue";
import type { Candle } from "../data/types";

const props = defineProps<{
  candle: Candle | null;
  symbol: string;
  interval: string;
  indicators?: Array<{ label: string; value: number | null; color: string }>;
}>();

const isExpanded = ref(true);

const fmt = (n: number) => (n ?? 0).toFixed(2);
const getColor = (c: Candle) =>
  c.close >= c.open ? "text-[#26a69a]" : "text-[#ef5350]";

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
};
</script>

<template>
  <div
    class="absolute top-3 left-3 z-20 font-mono text-xs pointer-events-none select-none bg-[#10141f]/60 rounded backdrop-blur-sm shadow-lg"
    :class="isExpanded ? 'p-1 flex flex-wrap gap-x-3' : 'px-2 py-1 flex items-center gap-2'"
  >
    <button
      type="button"
      class="pointer-events-auto text-[10px] uppercase tracking-[0.3em] text-gray-400 hover:text-white transition-colors mr-2"
      @click.stop="toggleExpanded"
    >
      {{ isExpanded ? "Hide" : "Expand" }}
    </button>

    <template v-if="isExpanded">
      <span class="font-bold text-white text-sm">{{ symbol }}</span>
      <span class="text-gray-400 text-sm">{{ interval }}</span>

      <div v-if="candle" class="flex gap-3" :class="getColor(candle)">
        <span
          >O<span class="text-white ml-1">{{ fmt(candle.open ?? 0) }}</span></span
        >
        <span
          >H<span class="text-white ml-1">{{ fmt(candle.high ?? 0) }}</span></span
        >
        <span
          >L<span class="text-white ml-1">{{ fmt(candle.low ?? 0) }}</span></span
        >
        <span
          >C<span class="text-white ml-1">{{ fmt(candle.close ?? 0) }}</span></span
        >

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
          <span class="font-semibold" :style="{ color: indicator.color }">
            {{ indicator.label }}
          </span>
          <span class="text-white">{{ fmt(indicator.value ?? 0) }}</span>
        </div>
      </div>
    </template>

    <template v-else>
      <span class="font-bold text-white text-sm">{{ symbol }}</span>
      <span class="text-gray-400 text-xs">{{ interval }}</span>
      <span v-if="candle" class="text-white text-xs">
        C {{ fmt(candle.close ?? 0) }}
      </span>
      <span v-else class="text-gray-500 text-xs">Loading...</span>
    </template>
  </div>
</template>
