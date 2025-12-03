<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useTradingStore } from "../stores/tradingStore";
import { useReplayStore } from "../stores/replayStore";

const tradingStore = useTradingStore();
const replayStore = useReplayStore();
const { isAutoTrading } = storeToRefs(replayStore);
const { tradingConfig } = storeToRefs(tradingStore);
const PRICE_TOLERANCE = 1e-6;

const orderMargin = ref(100);
const leverageOptions = [1, 2, 3, 5, 10, 15, 20, 25];
const stopLossPrice = ref<number | null>(null);
const takeProfitPrice = ref<number | null>(null);
const orderMode = ref<"market" | "pending">("market");
const pendingEntryPrice = ref<number | null>(null);

// --- Settings State ---
const localStartingBalance = ref(100);
const localTradeHistoryLimit = ref(100);

function syncConfigToLocal() {
  localStartingBalance.value = tradingConfig.value.startingBalance;
  localTradeHistoryLimit.value = tradingConfig.value.tradeHistoryLimit;
}

onMounted(() => {
  syncConfigToLocal();
});

watch(
  tradingConfig,
  () => {
    syncConfigToLocal();
  },
  { deep: true }
);

function handleSaveSettings() {
  tradingStore.updateTradingConfig({
    startingBalance: Number(localStartingBalance.value),
    tradeHistoryLimit: Number(localTradeHistoryLimit.value),
  });
}
// --- End Settings State ---

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

const autoTradingStatus = computed(() =>
  isAutoTrading.value ? "Auto Trading: On" : "Auto Trading: Off"
);

const canTrade = computed(() => !!currentPrice.value && !!currentTime.value);

const calculatedSize = computed(() => {
  if (!currentPrice.value) return 0;
  return (orderMargin.value * tradingStore.leverage) / currentPrice.value;
});

const marginRequirement = computed(() => {
  return Math.max(orderMargin.value, 0);
});

const hasMargin = computed(
  () =>
    marginRequirement.value === 0 ||
    tradingStore.cashBalance + 1e-8 >= marginRequirement.value
);

const formattedMarginRequirement = computed(() =>
  formatCurrency(marginRequirement.value)
);

const marginColor = computed(() =>
  !currentPrice.value ? "#9ca3af" : hasMargin.value ? "#26a69a" : "#ef5350"
);

const effectiveEntryPrice = computed(() => {
  if (orderMode.value === "pending" && pendingEntryPrice.value) {
    return pendingEntryPrice.value;
  }
  return currentPrice.value ?? null;
});

const pendingOrderHint = computed(() => {
  if (orderMode.value !== "pending") {
    return "Market orders execute immediately at the current price.";
  }
  if (!pendingEntryPrice.value || !currentPrice.value) {
    return "Set an entry price to create a limit or stop order.";
  }
  const buyType = determineOrderType(
    "long",
    pendingEntryPrice.value,
    currentPrice.value
  );
  const sellType = determineOrderType(
    "short",
    pendingEntryPrice.value,
    currentPrice.value
  );
  return `Buy ${
    buyType?.toUpperCase() ?? "--"
  } / Sell ${sellType?.toUpperCase() ?? "--"}`;
});

const projectedSlPnl = computed(() => {
  if (!effectiveEntryPrice.value || !stopLossPrice.value) return null;
  const size = calculatedSize.value;
  if (size <= 0) return null;
  const diff = stopLossPrice.value - effectiveEntryPrice.value;
  return {
    long: diff * size,
    short: -diff * size,
  };
});

const projectedTpPnl = computed(() => {
  if (!effectiveEntryPrice.value || !takeProfitPrice.value) return null;
  const size = calculatedSize.value;
  if (size <= 0) return null;
  const diff = takeProfitPrice.value - effectiveEntryPrice.value;
  return {
    long: diff * size,
    short: -diff * size,
  };
});

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

function formatSigned(value: number) {
  const formatted = formatNumber(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function pnlColor(value: number) {
  if (value === 0) return "#d1d5db";
  return value > 0 ? "#26a69a" : "#ef5350";
}

function normalizedLevel(value: number | null) {
  return value && value > 0 ? value : null;
}

function resetProtectionLevels() {
  stopLossPrice.value = null;
  takeProfitPrice.value = null;
}

function handleBuy() {
  if (orderMode.value === "pending") {
    placePendingOrder("long");
    return;
  }
  if (!canTrade.value || !currentPrice.value || !currentTime.value) return;
  if (!hasMargin.value) return;
  const qty = calculatedSize.value;
  if (qty <= 0) return;
  const executed = tradingStore.marketBuy(
    qty,
    currentPrice.value,
    currentTime.value,
    {
      slPrice: normalizedLevel(stopLossPrice.value),
      tpPrice: normalizedLevel(takeProfitPrice.value),
    }
  );
  if (executed) {
    resetProtectionLevels();
  }
}

function handleSell() {
  if (orderMode.value === "pending") {
    placePendingOrder("short");
    return;
  }
  if (!currentPrice.value || !currentTime.value) return;
  if (!hasMargin.value) return;
  const qty = calculatedSize.value;
  if (qty <= 0) return;
  const executed = tradingStore.marketSell(
    qty,
    currentPrice.value,
    currentTime.value,
    {
      slPrice: normalizedLevel(stopLossPrice.value),
      tpPrice: normalizedLevel(takeProfitPrice.value),
    }
  );
  if (executed) {
    resetProtectionLevels();
  }
}

function handleCloseAll() {
  if (!currentPrice.value || !currentTime.value) return;
  tradingStore.closeAllPositions(currentPrice.value, currentTime.value);
}

function handleClosePosition(positionId: number) {
  if (!currentPrice.value || !currentTime.value) return;
  tradingStore.closePosition(positionId, currentPrice.value, currentTime.value);
}

function toggleAutoTrading() {
  replayStore.setAutoTrading(!isAutoTrading.value);
}

function handleLeverageChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  tradingStore.setLeverage(value);
}

const enrichedPositions = computed(() => {
  const price = currentPrice.value;
  return tradingStore.openPositions.map((pos) => ({
    ...pos,
    unrealized: price
      ? (price - pos.entryPrice) * pos.size * (pos.side === "long" ? 1 : -1)
      : 0,
  }));
});

function formatTimestamp(ts?: number) {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

function determineOrderType(
  side: "long" | "short",
  targetPrice: number,
  referencePrice: number | null
): "limit" | "stop" | null {
  if (!referencePrice) return null;
  const diff = targetPrice - referencePrice;
  if (Math.abs(diff) <= PRICE_TOLERANCE) {
    return "limit";
  }
  if (side === "long") {
    return diff < 0 ? "limit" : "stop";
  }
  return diff > 0 ? "limit" : "stop";
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "-";
  const days = Math.floor(seconds / (24 * 3600));
  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) {
    return `${hours}h`;
  }
  const minutes = Math.floor((seconds % 3600) / 60);
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${Math.floor(seconds)}s`;
}

function formatRiskReward(value?: number | null) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(2);
}

function placePendingOrder(side: "long" | "short") {
  if (
    !canTrade.value ||
    !currentPrice.value ||
    !currentTime.value ||
    !pendingEntryPrice.value ||
    pendingEntryPrice.value <= 0
  ) {
    return;
  }
  if (!hasMargin.value) return;
  const qty = calculatedSize.value;
  if (qty <= 0) return;
  const orderType = determineOrderType(
    side,
    pendingEntryPrice.value,
    currentPrice.value
  );
  if (!orderType) return;
  const placed = tradingStore.placeOrder(
    side,
    orderType,
    pendingEntryPrice.value,
    qty,
    currentTime.value,
    {
      slPrice: normalizedLevel(stopLossPrice.value),
      tpPrice: normalizedLevel(takeProfitPrice.value),
    }
  );
  if (placed) {
    resetProtectionLevels();
  }
}

function pendingButtonText(side: "long" | "short") {
  if (orderMode.value === "market") {
    if (side === "long") {
      return `Buy @ ${
        currentPrice.value ? formatNumber(currentPrice.value) : "--"
      }`;
    }
    return "Sell / Short";
  }

  const typeLabel =
    pendingEntryPrice.value && currentPrice.value
      ? determineOrderType(
          side,
          pendingEntryPrice.value,
          currentPrice.value
        )?.toUpperCase()
      : null;

  const action = side === "long" ? "Place Buy" : "Place Sell";
  return typeLabel ? `${action} (${typeLabel})` : `${action} Order`;
}

function handleCancelOrder(orderId: number) {
  tradingStore.cancelOrder(orderId);
}

watch(orderMode, (mode) => {
  if (mode === "market") {
    pendingEntryPrice.value = null;
  } else if (!pendingEntryPrice.value && currentPrice.value) {
    pendingEntryPrice.value = currentPrice.value;
  }
});
</script>

<template>
  <div
    class="w-full md:w-80 lg:w-96 bg-[#0b111e] border-l border-gray-800 flex flex-col text-sm"
  >
    <div class="p-4 border-b border-gray-800 space-y-3">
      <div class="flex justify-between text-sm text-gray-300">
        <span>Cash</span>
        <span>{{ formatCurrency(tradingStore.cashBalance) }}</span>
      </div>
      <div class="flex justify-between text-sm text-gray-300">
        <span>Equity</span>
        <span>{{ formatCurrency(equity) }}</span>
      </div>
      <div class="flex justify-between text-sm text-gray-300">
        <span>Realized PnL</span>
        <span :style="{ color: pnlColor(tradingStore.realizedPnL) }">
          {{ formatSigned(tradingStore.realizedPnL) }}
        </span>
      </div>
      <div class="flex justify-between text-sm text-gray-300">
        <span>Unrealized PnL</span>
        <span :style="{ color: pnlColor(unrealizedPnL) }">
          {{ formatSigned(unrealizedPnL) }}
        </span>
      </div>
      <div class="flex items-center justify-between pt-1">
        <div class="flex flex-col">
          <span class="text-xs uppercase tracking-widest text-gray-400"
            >Golden Trend</span
          >
          <span
            class="text-sm"
            :class="isAutoTrading ? 'text-green-400' : 'text-gray-400'"
          >
            {{ autoTradingStatus }}
          </span>
        </div>
        <button
          class="px-3 py-1.5 rounded text-xs font-semibold border"
          :class="
            isAutoTrading
              ? 'border-green-500 text-green-100 hover:border-green-400'
              : 'border-gray-600 text-gray-200 hover:border-blue-500'
          "
          @click="toggleAutoTrading"
        >
          {{ isAutoTrading ? "Stop Bot" : "Start Bot" }}
        </button>
      </div>
      <div class="pt-2 flex items-center gap-2">
        <input
          v-model.number="orderMargin"
          type="number"
          min="1"
          step="1"
          class="flex-1 rounded bg-[#111a2c] border border-gray-700 px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          placeholder="Order Margin (USDT)"
        />
        <span class="text-sm text-gray-400">USDT</span>
      </div>
      <div class="flex items-center justify-between text-sm text-gray-300">
        <span>Leverage</span>
        <select
          class="bg-[#111a2c] border border-gray-700 rounded px-2 py-1 text-gray-100 text-sm"
          :value="tradingStore.leverage"
          @change="handleLeverageChange"
        >
          <option
            v-for="value in leverageOptions"
            :key="value"
            :value="value"
          >
            {{ value }}x
          </option>
        </select>
      </div>
      <div
        class="flex justify-between text-sm px-2 py-1 rounded border"
        :style="{ color: marginColor, borderColor: marginColor }"
      >
        <span>Margin Required ({{ tradingStore.leverage }}x)</span>
        <span>{{ formattedMarginRequirement }}</span>
      </div>
      <div class="flex justify-between text-sm text-gray-400">
        <span>Est. Qty</span>
        <span class="text-gray-200">{{
          formatNumber(calculatedSize || 0)
        }}</span>
      </div>
      <div class="flex items-center gap-2 text-sm text-gray-300">
        <button
          type="button"
          class="flex-1 py-1.5 rounded border font-semibold"
          :class="
            orderMode === 'market'
              ? 'border-blue-500 text-blue-100 bg-blue-500/20'
              : 'border-gray-700 text-gray-400 hover:border-blue-500 hover:text-blue-100'
          "
          @click="orderMode = 'market'"
        >
          Market
        </button>
        <button
          type="button"
          class="flex-1 py-1.5 rounded border font-semibold"
          :class="
            orderMode === 'pending'
              ? 'border-blue-500 text-blue-100 bg-blue-500/20'
              : 'border-gray-700 text-gray-400 hover:border-blue-500 hover:text-blue-100'
          "
          @click="orderMode = 'pending'"
        >
          Limit / Stop
        </button>
      </div>
      <div class="text-sm text-gray-400">{{ pendingOrderHint }}</div>
      <div v-if="orderMode === 'pending'" class="space-y-1">
        <label class="text-sm uppercase tracking-widest text-gray-400"
          >Entry Price</label
        >
        <input
          v-model.number="pendingEntryPrice"
          type="number"
          min="0"
          step="0.01"
          class="w-full rounded bg-[#111a2c] border border-gray-700 px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          placeholder="Entry Price"
        />
      </div>
      <div class="grid grid-cols-2 gap-2 pt-2">
        <div class="flex items-center gap-2">
          <input
            v-model.number="stopLossPrice"
            type="number"
            min="0"
            step="0.01"
            class="w-full rounded bg-[#111a2c] border border-gray-700 px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="SL Price"
          />
          <span class="text-sm text-gray-400">SL</span>
        </div>
        <div class="flex items-center gap-2">
          <input
            v-model.number="takeProfitPrice"
            type="number"
            min="0"
            step="0.01"
            class="w-full rounded bg-[#111a2c] border border-gray-700 px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="TP Price"
          />
          <span class="text-sm text-gray-400">TP</span>
        </div>
      </div>
      <div class="space-y-2 text-sm text-gray-300">
        <div v-if="projectedSlPnl">
          <div class="font-semibold">SL PnL</div>
          <div class="flex gap-4">
            <span :style="{ color: pnlColor(projectedSlPnl.long) }">
              Buy: {{ formatSigned(projectedSlPnl.long) }}
            </span>
            <span :style="{ color: pnlColor(projectedSlPnl.short) }">
              Sell: {{ formatSigned(projectedSlPnl.short) }}
            </span>
          </div>
        </div>
        <div v-if="projectedTpPnl">
          <div class="font-semibold">TP PnL</div>
          <div class="flex gap-4">
            <span :style="{ color: pnlColor(projectedTpPnl.long) }">
              Buy: {{ formatSigned(projectedTpPnl.long) }}
            </span>
            <span :style="{ color: pnlColor(projectedTpPnl.short) }">
              Sell: {{ formatSigned(projectedTpPnl.short) }}
            </span>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 pt-2">
        <button
          class="py-2 rounded bg-green-600 hover:bg-green-500 text-white text-sm font-semibold disabled:opacity-40"
          :disabled="
            !canTrade ||
            !hasMargin ||
            (orderMode === 'pending' &&
              (!pendingEntryPrice || pendingEntryPrice <= 0))
          "
          @click="handleBuy"
        >
          {{ pendingButtonText("long") }}
        </button>
        <button
          class="py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40"
          :disabled="
            !canTrade ||
            !hasMargin ||
            (orderMode === 'pending' &&
              (!pendingEntryPrice || pendingEntryPrice <= 0))
          "
          @click="handleSell"
        >
          {{ pendingButtonText("short") }}
        </button>
      </div>
      <button
        class="w-full mt-2 py-2 rounded border border-gray-600 text-sm font-semibold text-gray-200 hover:border-blue-500 disabled:opacity-40"
        :disabled="!canTrade || tradingStore.openPositions.length === 0"
        @click="handleCloseAll"
      >
        Close All Positions
      </button>
    </div>

    <div class="p-4 border-b border-gray-800 flex-1 overflow-auto space-y-4">
      <div>
        <h3 class="text-sm uppercase tracking-widest text-gray-400 mb-2">
          Open Positions
        </h3>
        <div
          v-if="enrichedPositions.length === 0"
          class="text-sm text-gray-400"
        >
          No open trades.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="position in enrichedPositions"
            :key="position.id"
            class="bg-[#10192f] rounded p-2 text-sm text-gray-200"
          >
            <div class="flex justify-between">
              <span>Side</span>
              <span class="uppercase">{{ position.side }}</span>
            </div>
            <div class="flex justify-between">
              <span>Size</span>
              <span>{{ formatNumber(position.size) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Entry</span>
              <span>{{ formatNumber(position.entryPrice) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Leverage</span>
              <span>{{ position.leverage }}x</span>
            </div>
            <div v-if="position.slPrice" class="flex justify-between">
              <span>SL</span>
              <span>{{ formatNumber(position.slPrice) }}</span>
            </div>
            <div v-if="position.tpPrice" class="flex justify-between">
              <span>TP</span>
              <span>{{ formatNumber(position.tpPrice) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Unrealized</span>
              <span :style="{ color: pnlColor(position.unrealized) }">
                {{ formatSigned(position.unrealized) }}
              </span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ formatTimestamp(position.entryTime) }}
            </div>
            <button
              class="mt-2 w-full py-1.5 rounded border border-gray-600 text-gray-200 text-sm font-semibold hover:border-blue-500 disabled:opacity-40"
              :disabled="!canTrade"
              @click="handleClosePosition(position.id)"
            >
              Close This Position
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 class="text-sm uppercase tracking-widest text-gray-400 mb-2">
          Working Orders
        </h3>
        <div
          v-if="tradingStore.pendingOrders.length === 0"
          class="text-sm text-gray-400"
        >
          No pending orders.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="order in tradingStore.pendingOrders"
            :key="order.id"
            class="bg-[#10192f] rounded p-2 text-sm text-gray-200"
          >
            <div class="flex justify-between">
              <span>Side / Type</span>
              <span class="uppercase"
                >{{ order.side }} {{ order.orderType }}</span
              >
            </div>
            <div class="flex justify-between">
              <span>Entry</span>
              <span>{{ formatNumber(order.price) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Size</span>
              <span>{{ formatNumber(order.size) }}</span>
            </div>
            <div v-if="order.slPrice" class="flex justify-between">
              <span>SL</span>
              <span>{{ formatNumber(order.slPrice) }}</span>
            </div>
            <div v-if="order.tpPrice" class="flex justify-between">
              <span>TP</span>
              <span>{{ formatNumber(order.tpPrice) }}</span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ formatTimestamp(order.createdTime) }}
            </div>
            <button
              class="mt-2 w-full py-1.5 rounded border border-gray-600 text-gray-200 text-sm font-semibold hover:border-red-500"
              @click="handleCancelOrder(order.id)"
            >
              Cancel Order
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 class="text-sm uppercase tracking-widest text-gray-400 mb-2">
          Trade History
        </h3>
        <div
          v-if="tradingStore.tradeHistory.length === 0"
          class="text-sm text-gray-400"
        >
          No closed trades.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="trade in tradingStore.tradeHistory"
            :key="trade.exitTime + '-' + trade.id"
            class="bg-[#10192f] rounded p-2 text-sm text-gray-200"
          >
            <div class="flex justify-between">
              <span>Side</span>
              <span class="uppercase">{{ trade.side }}</span>
            </div>
            <div class="flex justify-between">
              <span>Size</span>
              <span>{{ formatNumber(trade.size) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Entry/Exit</span>
              <span
                >{{ formatNumber(trade.entryPrice) }} →
                {{ formatNumber(trade.exitPrice) }}</span
              >
            </div>
            <div class="flex justify-between">
              <span>Leverage</span>
              <span>{{ trade.leverage }}x</span>
            </div>
            <div class="flex justify-between">
              <span>PnL</span>
              <span :style="{ color: pnlColor(trade.pnl) }">
                {{ formatSigned(trade.pnl) }}
              </span>
            </div>
            <div class="flex justify-between">
              <span>R:R</span>
              <span>{{ formatRiskReward(trade.riskReward) }}</span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              <span>Closed: {{ formatTimestamp(trade.exitTime) }}</span>
              <span class="ml-2 text-gray-400"
                >Duration: {{ formatDuration(trade.durationSeconds) }}</span
              >
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 class="text-sm uppercase tracking-widest text-gray-400 mb-2">
          Session Settings
        </h3>
        <div class="bg-[#10192f] rounded p-2 text-sm text-gray-200 space-y-3">
          <div class="flex justify-between items-center">
            <label for="starting-balance" class="text-gray-300"
              >Starting Balance (USD)</label
            >
            <input
              id="starting-balance"
              v-model.number="localStartingBalance"
              type="number"
              min="1"
              step="100"
              class="w-32 rounded bg-[#111a2c] border border-gray-700 px-2 py-1 text-sm text-right text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div class="flex justify-between items-center">
            <label for="history-limit" class="text-gray-300"
              >Trade History Limit</label
            >
            <input
              id="history-limit"
              v-model.number="localTradeHistoryLimit"
              type="number"
              min="10"
              max="1000"
              step="10"
              class="w-32 rounded bg-[#111a2c] border border-gray-700 px-2 py-1 text-sm text-right text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            class="w-full mt-2 py-1.5 rounded border border-blue-600 text-sm font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-40"
            @click="handleSaveSettings"
          >
            Save & Reset Session
          </button>
        </div>
      </div>
    </div>
  </div>
</template>