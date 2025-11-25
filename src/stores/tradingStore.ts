import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { UTCTimestamp } from "lightweight-charts";

type PositionSide = "long" | "short";

interface Position {
  id: number;
  size: number;
  entryPrice: number;
  entryTime: UTCTimestamp;
  side: PositionSide;
}

interface ClosedTrade extends Position {
  exitPrice: number;
  exitTime: UTCTimestamp;
  pnl: number;
}

interface TradeMarker {
  id: string;
  time: UTCTimestamp;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown";
  color: string;
  text: string;
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
      entryTime: time as UTCTimestamp,
      side: "long",
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
      const direction = position.side === "long" ? 1 : -1;
      const pnl = (price - position.entryPrice) * closeAmount * direction;
      realizedPnL.value += pnl;
      cashBalance.value += closeAmount * price;

      tradeHistory.value.unshift({
        id: position.id,
        size: closeAmount,
        entryPrice: position.entryPrice,
        entryTime: position.entryTime,
        exitPrice: price,
        exitTime: time as UTCTimestamp,
        side: position.side,
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
    return openPositions.value.reduce((sum, pos) => {
      const direction = pos.side === "long" ? 1 : -1;
      return sum + (markPrice - pos.entryPrice) * pos.size * direction;
    }, 0);
  }

  function getEquity(markPrice?: number | null) {
    const mark = markPrice ?? null;
    const positionValue = openPositions.value.reduce((sum, pos) => {
      const price = mark ?? pos.entryPrice;
      const direction = pos.side === "long" ? 1 : -1;
      return sum + pos.size * price * direction;
    }, 0);
    return cashBalance.value + positionValue;
  }

  const tradeMarkers = computed<TradeMarker[]>(() => {
    const markers: TradeMarker[] = [];

    for (const position of openPositions.value) {
      markers.push({
        id: `open-${position.id}`,
        time: position.entryTime,
        position: position.side === "long" ? "belowBar" : "aboveBar",
        shape: position.side === "long" ? "arrowUp" : "arrowDown",
        color: position.side === "long" ? "#26a69a" : "#ef5350",
        text: `${position.side === "long" ? "BUY" : "SELL"}`,
      });
    }

    for (const trade of tradeHistory.value) {
      markers.push({
        id: `close-${trade.id}-${trade.exitTime}`,
        time: trade.exitTime,
        position: trade.side === "long" ? "aboveBar" : "belowBar",
        shape: trade.side === "long" ? "arrowDown" : "arrowUp",
        color: trade.side === "long" ? "#ef5350" : "#26a69a",
        text: trade.pnl >= 0 ? `+${trade.pnl.toFixed(2)}` : trade.pnl.toFixed(2),
      });
    }

    return markers;
  });

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
    tradeMarkers,
  };
});
