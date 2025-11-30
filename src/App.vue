<script setup lang="ts">
import { ref, watch } from "vue";
import ChartContainer from "./components/ChartContainer.vue";
import ScrubBar from "./components/ScrubBar.vue";
import TimeframeTabs from "./components/TimeframeTabs.vue";
import TradingPanel from "./components/TradingPanel.vue";
import { useReplayStore } from "./stores/replayStore";
import { useTradingStore } from "./stores/tradingStore";

const store = useReplayStore();
const tradingStore = useTradingStore();
const colorInputs = ref<Record<string, HTMLInputElement | null>>({});

watch(
  () => store.visibleDatasets[store.activeTimeframe],
  (dataset) => {
    const candle = dataset?.[dataset.length - 1];
    if (candle) {
      tradingStore.checkOrders(candle);
    }
  },
  { deep: true }
);

function setColorInputRef(id: string, element: HTMLInputElement | null) {
  colorInputs.value[id] = element;
}

function openColorPicker(id: string) {
  const input = colorInputs.value[id];
  input?.click();
}

function handleIndicatorColorChange(id: string, event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;
  store.setIndicatorColor(id, target.value);
}
</script>

<template>
  <div class="flex flex-col w-screen h-screen bg-[#10141f] overflow-hidden">
    <!-- Main Chart Area -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <div
        class="flex items-center gap-4 border-b border-gray-800 bg-[#0b111e] px-4 py-3"
      >
        <div class="flex items-center gap-3">
          <div class="text-[11px] uppercase tracking-[0.3em] text-gray-500">
            Symbol
          </div>
          <select
            class="bg-[#111a2c] border border-gray-700 rounded px-3 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
            :value="store.activeSymbol"
            @change="(event) => store.setSymbol((event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="symbol in store.availableSymbols"
              :key="symbol"
              :value="symbol"
            >
              {{ symbol }}
            </option>
          </select>
          <div class="text-[11px] uppercase tracking-[0.3em] text-gray-500">
            Timeframes
          </div>
        </div>
        <TimeframeTabs />
        <button
          type="button"
          class="px-4 py-2 text-xs font-semibold uppercase tracking-widest rounded border transition-colors"
          :class="
            store.isSelectingReplay
              ? 'border-blue-500 bg-blue-600 text-white'
              : 'border-gray-700 text-gray-300 hover:border-blue-500 hover:text-blue-100'
          "
          @click="store.toggleReplaySelection"
        >
          {{ store.isSelectingReplay ? "Cancel Replay" : "Bar Replay" }}
        </button>

        <div class="ml-auto flex items-center gap-3">
          <span class="text-[11px] uppercase tracking-[0.25em] text-gray-500"
            >Indicators</span
          >
          <div class="flex flex-wrap gap-2 items-center">
            <div
              v-for="indicator in store.indicatorDefinitions"
              :key="indicator.id"
              class="flex items-center gap-1 relative"
            >
              <button
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
              <button
                type="button"
                class="w-4 h-4 rounded-full border border-gray-700 flex-shrink-0 pointer-events-auto hover:opacity-80 transition"
                :style="{ backgroundColor: indicator.color }"
                :title="`Edit ${indicator.label} color`"
                @click="openColorPicker(indicator.id)"
              ></button>
              <input
                type="color"
                class="absolute opacity-0 pointer-events-none w-0 h-0"
                :value="indicator.color"
                :ref="(el) =>
                  setColorInputRef(indicator.id, el as HTMLInputElement | null)
                "
                @input="(event) => handleIndicatorColorChange(indicator.id, event)"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="flex-1 flex overflow-hidden">
        <div class="flex-1 relative">
          <ChartContainer :timeframe="store.activeTimeframe" />
        </div>
        <TradingPanel />
      </div>
    </div>

    <!-- Scrub Bar at Bottom -->
    <div class="flex-none">
      <ScrubBar />
    </div>
  </div>
</template>
