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
    const tradeTime = time as UTCTimestamp;

    const { remaining, closed } = closePositions("short", size, price, tradeTime);
    let executed = closed > 0;

    if (remaining <= 0) {
      return executed;
    }

    const cost = remaining * price;
    if (cashBalance.value + 1e-8 < cost) {
      return executed;
    }

    openPositions.value.push({
      id: nextPositionId++,
      size: remaining,
      entryPrice: price,
      entryTime: tradeTime,
      side: "long",
    });
    cashBalance.value -= cost;
    executed = true;
    return executed;
  }

  function marketSell(size: number, price: number, time: number) {
    if (size <= 0 || price <= 0) return false;
    const tradeTime = time as UTCTimestamp;

    const { remaining, closed } = closePositions("long", size, price, tradeTime);
    let executed = closed > 0;

    if (remaining <= 0) {
      return executed;
    }

    openPositions.value.push({
      id: nextPositionId++,
      size: remaining,
      entryPrice: price,
      entryTime: tradeTime,
      side: "short",
    });
    cashBalance.value += remaining * price;
    executed = true;
    return executed;
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

  function closePositions(
    targetSide: PositionSide,
    size: number,
    price: number,
    time: UTCTimestamp,
    options?: { positionId?: number }
  ) {
    if (size <= 0) {
      return { remaining: 0, closed: 0 };
    }

    let remainingToClose = size;
    let closed = 0;
    const updatedPositions: Position[] = [];

    for (const position of openPositions.value) {
      if (position.side !== targetSide) {
        updatedPositions.push(position);
        continue;
      }

      if (remainingToClose <= 0) {
        updatedPositions.push(position);
        continue;
      }

      if (options?.positionId && position.id !== options.positionId) {
        updatedPositions.push(position);
        continue;
      }

      const closeAmount = Math.min(position.size, remainingToClose);
      const direction = position.side === "long" ? 1 : -1;
      const pnl = (price - position.entryPrice) * closeAmount * direction;
      realizedPnL.value += pnl;
      closed += closeAmount;

      if (targetSide === "long") {
        cashBalance.value += closeAmount * price;
      } else {
        cashBalance.value -= closeAmount * price;
      }

      tradeHistory.value.unshift({
        id: position.id,
        size: closeAmount,
        entryPrice: position.entryPrice,
        entryTime: position.entryTime,
        exitPrice: price,
        exitTime: time,
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
    return { remaining: remainingToClose, closed };
  }

  function closePosition(
    positionId: number,
    price?: number | null,
    time?: number | null
  ) {
    if (!price || !time) return false;
    const position = openPositions.value.find((pos) => pos.id === positionId);
    if (!position) return false;

    closePositions(
      position.side,
      position.size,
      price,
      time as UTCTimestamp,
      { positionId }
    );
    return true;
  }

  function closeAllPositions(price?: number | null, time?: number | null) {
    if (!price || !time) return false;
    const tradeTime = time as UTCTimestamp;
    closePositions("long", Number.MAX_SAFE_INTEGER, price, tradeTime);
    closePositions("short", Number.MAX_SAFE_INTEGER, price, tradeTime);
    return true;
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
    closePosition,
    closeAllPositions,
    totalOpenSize,
    getUnrealizedPnL,
    getEquity,
    tradeMarkers,
  };
});
