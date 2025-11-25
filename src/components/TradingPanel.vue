<script setup lang="ts">
import { computed, ref } from "vue";
import { useTradingStore } from "../stores/tradingStore";
import { useReplayStore } from "../stores/replayStore";

const tradingStore = useTradingStore();
const replayStore = useReplayStore();

const orderSize = ref(1);

const currentCandle = computed(() => {
  const dataset = replayStore.visibleDatasets[replayStore.activeTimeframe] || [];
  return dataset[dataset.length - 1] || null;
});

const currentPrice = computed(() => currentCandle.value?.close ?? null);
const currentTime = computed(() => currentCandle.value?.time ?? null);

const unrealizedPnL = computed(() =>
  tradingStore.getUnrealizedPnL(currentPrice.value)
);

const equity = computed(() => tradingStore.getEquity(currentPrice.value));

const canTrade = computed(() => !!currentPrice.value && !!currentTime.value);

function formatCurrency(value: number) {
  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  return value.toFixed(2);
}

function handleBuy() {
  if (!canTrade.value || !currentPrice.value || !currentTime.value) return;
  tradingStore.marketBuy(
    Math.max(orderSize.value, 0.0001),
    currentPrice.value,
    currentTime.value
  );
}

function handleSell() {
  if (!currentPrice.value || !currentTime.value) return;
  tradingStore.marketSell(
    Math.max(orderSize.value, 0.0001),
    currentPrice.value,
    currentTime.value
  );
}

const enrichedPositions = computed(() => {
  const price = currentPrice.value;
  return tradingStore.openPositions.map((pos) => ({
    ...pos,
    unrealized: price ? (price - pos.entryPrice) * pos.size : 0,
  }));
});

function formatTimestamp(ts?: number) {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}
</script>

<template>
  <div class="w-full md:w-80 lg:w-96 bg-[#0b111e] border-l border-gray-800 flex flex-col">
    <div class="p-4 border-b border-gray-800 space-y-3">
      <div class="flex justify-between text-xs text-gray-400">
        <span>Cash</span>
        <span>{{ formatCurrency(tradingStore.cashBalance) }}</span>
      </div>
      <div class="flex justify-between text-xs text-gray-400">
        <span>Equity</span>
        <span>{{ formatCurrency(equity) }}</span>
      </div>
      <div class="flex justify-between text-xs text-gray-400">
        <span>Realized PnL</span>
        <span :class="tradingStore.realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'">
          {{ formatNumber(tradingStore.realizedPnL) }}
        </span>
      </div>
      <div class="flex justify-between text-xs text-gray-400">
        <span>Unrealized PnL</span>
        <span :class="unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'">
          {{ formatNumber(unrealizedPnL) }}
        </span>
      </div>
      <div class="pt-2 flex items-center gap-2">
        <input
          v-model.number="orderSize"
          type="number"
          min="0.001"
          step="0.001"
          class="flex-1 rounded bg-[#111a2c] border border-gray-700 px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        />
        <span class="text-xs text-gray-500">Qty</span>
      </div>
      <div class="grid grid-cols-2 gap-2 pt-2">
        <button
          class="py-2 rounded bg-green-600 hover:bg-green-500 text-white text-sm font-semibold"
          :disabled="!currentPrice"
          @click="handleBuy"
        >
          Buy @ {{ currentPrice ? formatNumber(currentPrice) : '--' }}
        </button>
        <button
          class="py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-semibold"
          :disabled="tradingStore.totalOpenSize <= 0 || !currentPrice"
          @click="handleSell"
        >
          Sell
        </button>
      </div>
    </div>

    <div class="p-4 border-b border-gray-800 flex-1 overflow-auto space-y-4">
      <div>
        <h3 class="text-xs uppercase tracking-widest text-gray-500 mb-2">
          Open Positions
        </h3>
        <div v-if="enrichedPositions.length === 0" class="text-xs text-gray-500">
          No open trades.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="position in enrichedPositions"
            :key="position.id"
            class="bg-[#10192f] rounded p-2 text-xs text-gray-300"
          >
            <div class="flex justify-between">
              <span>Size</span>
              <span>{{ formatNumber(position.size) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Entry</span>
              <span>{{ formatNumber(position.entryPrice) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Unrealized</span>
              <span :class="position.unrealized >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ formatNumber(position.unrealized) }}
              </span>
            </div>
            <div class="text-[10px] text-gray-500 mt-1">
              {{ formatTimestamp(position.entryTime) }}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 class="text-xs uppercase tracking-widest text-gray-500 mb-2">
          Trade History
        </h3>
        <div v-if="tradingStore.tradeHistory.length === 0" class="text-xs text-gray-500">
          No closed trades.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="trade in tradingStore.tradeHistory"
            :key="trade.exitTime + '-' + trade.id"
            class="bg-[#10192f] rounded p-2 text-xs text-gray-300"
          >
            <div class="flex justify-between">
              <span>Size</span>
              <span>{{ formatNumber(trade.size) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Entry/Exit</span>
              <span>{{ formatNumber(trade.entryPrice) }} → {{ formatNumber(trade.exitPrice) }}</span>
            </div>
            <div class="flex justify-between">
              <span>PnL</span>
              <span :class="trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ formatNumber(trade.pnl) }}
              </span>
            </div>
            <div class="text-[10px] text-gray-500 mt-1">
              {{ formatTimestamp(trade.exitTime) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
