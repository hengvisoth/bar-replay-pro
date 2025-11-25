import { defineStore } from "pinia";
import { ref, computed } from "vue";

interface Position {
  id: number;
  size: number;
  entryPrice: number;
  entryTime: number;
}

interface ClosedTrade extends Position {
  exitPrice: number;
  exitTime: number;
  pnl: number;
}

const STARTING_BALANCE = 10_000;

export const useTradingStore = defineStore("trading", () => {
  const cashBalance = ref(STARTING_BALANCE);
  const openPositions = ref<Position[]>([]);
  const tradeHistory = ref<ClosedTrade[]>([]);
  const realizedPnL = ref(0);
  let nextPositionId = 1;

  const totalOpenSize = computed(() =>
    openPositions.value.reduce((sum, pos) => sum + pos.size, 0)
  );

  const availableBalance = computed(() => cashBalance.value);

  function marketBuy(size: number, price: number, time: number) {
    if (size <= 0 || price <= 0) return false;
    const cost = size * price;
    if (cashBalance.value + 1e-8 < cost) {
      return false;
    }

    openPositions.value.push({
      id: nextPositionId++,
      size,
      entryPrice: price,
      entryTime: time,
    });
    cashBalance.value -= cost;
    return true;
  }

  function marketSell(size: number, price: number, time: number) {
    if (size <= 0 || price <= 0) return false;
    const remainingOpenSize = totalOpenSize.value;
    if (remainingOpenSize <= 0) {
      return false;
    }

    let remainingToClose = Math.min(size, remainingOpenSize);
    const updatedPositions: Position[] = [];

    for (const position of openPositions.value) {
      if (remainingToClose <= 0) {
        updatedPositions.push(position);
        continue;
      }

      const closeAmount = Math.min(position.size, remainingToClose);
      const pnl = (price - position.entryPrice) * closeAmount;
      realizedPnL.value += pnl;
      cashBalance.value += closeAmount * price;

      tradeHistory.value.unshift({
        id: position.id,
        size: closeAmount,
        entryPrice: position.entryPrice,
        entryTime: position.entryTime,
        exitPrice: price,
        exitTime: time,
        pnl,
      });

      if (tradeHistory.value.length > 100) {
        tradeHistory.value.pop();
      }

      const remainingSize = position.size - closeAmount;
      if (remainingSize > 1e-8) {
        updatedPositions.push({ ...position, size: remainingSize });
      }

      remainingToClose -= closeAmount;
    }

    openPositions.value = updatedPositions;
    return true;
  }

  function getUnrealizedPnL(markPrice?: number | null) {
    if (!markPrice) return 0;
    return openPositions.value.reduce(
      (sum, pos) => sum + (markPrice - pos.entryPrice) * pos.size,
      0
    );
  }

  function getEquity(markPrice?: number | null) {
    const markValue = openPositions.value.reduce((sum, pos) => {
      const price = markPrice || pos.entryPrice;
      return sum + pos.size * price;
    }, 0);
    return cashBalance.value + markValue;
  }

  return {
    startingBalance: STARTING_BALANCE,
    cashBalance,
    availableBalance,
    openPositions,
    tradeHistory,
    realizedPnL,
    marketBuy,
    marketSell,
    totalOpenSize,
    getUnrealizedPnL,
    getEquity,
  };
});
