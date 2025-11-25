import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../data/types";

type PositionSide = "long" | "short";

interface Position {
  id: number;
  size: number;
  entryPrice: number;
  entryTime: UTCTimestamp;
  side: PositionSide;
  margin: number;
  slPrice: number | null;
  tpPrice: number | null;
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
const MIN_LEVERAGE = 1;
const MAX_LEVERAGE = 25;

export const useTradingStore = defineStore("trading", () => {
  const cashBalance = ref(STARTING_BALANCE);
  const openPositions = ref<Position[]>([]);
  const tradeHistory = ref<ClosedTrade[]>([]);
  const realizedPnL = ref(0);
  const leverage = ref(5);
  let nextPositionId = 1;

  const totalOpenSize = computed(() =>
    openPositions.value.reduce((sum, pos) => sum + pos.size, 0)
  );

  const availableBalance = computed(() => cashBalance.value);

  function marketBuy(
    size: number,
    price: number,
    time: number,
    options?: { slPrice?: number | null; tpPrice?: number | null }
  ) {
    if (size <= 0 || price <= 0) return false;
    const tradeTime = time as UTCTimestamp;

    const { remaining, closed } = closePositions("short", size, price, tradeTime);
    let executed = closed > 0;

    if (remaining <= 0) {
      return executed;
    }

    const margin = calculateMargin(remaining, price);
    if (cashBalance.value + 1e-8 < margin) {
      return executed;
    }

    openPositions.value.push({
      id: nextPositionId++,
      size: remaining,
      entryPrice: price,
      entryTime: tradeTime,
      side: "long",
      margin,
      slPrice: sanitizeLevel(options?.slPrice),
      tpPrice: sanitizeLevel(options?.tpPrice),
    });
    cashBalance.value -= margin;
    executed = true;
    return executed;
  }

  function marketSell(
    size: number,
    price: number,
    time: number,
    options?: { slPrice?: number | null; tpPrice?: number | null }
  ) {
    if (size <= 0 || price <= 0) return false;
    const tradeTime = time as UTCTimestamp;

    const { remaining, closed } = closePositions("long", size, price, tradeTime);
    let executed = closed > 0;

    if (remaining <= 0) {
      return executed;
    }

    const margin = calculateMargin(remaining, price);
    if (cashBalance.value + 1e-8 < margin) {
      return executed;
    }

    openPositions.value.push({
      id: nextPositionId++,
      size: remaining,
      entryPrice: price,
      entryTime: tradeTime,
      side: "short",
      margin,
      slPrice: sanitizeLevel(options?.slPrice),
      tpPrice: sanitizeLevel(options?.tpPrice),
    });
    cashBalance.value -= margin;
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
    const unrealized = getUnrealizedPnL(markPrice ?? undefined);
    return cashBalance.value + unrealized;
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
      const marginPortion = position.margin * (closeAmount / position.size);
      cashBalance.value += marginPortion + pnl;

      tradeHistory.value.unshift({
        id: position.id,
        size: closeAmount,
        entryPrice: position.entryPrice,
        entryTime: position.entryTime,
        exitPrice: price,
        exitTime: time,
        side: position.side,
        margin: marginPortion,
        slPrice: position.slPrice,
        tpPrice: position.tpPrice,
        pnl,
      });

      if (tradeHistory.value.length > 100) {
        tradeHistory.value.pop();
      }

      const remainingSize = position.size - closeAmount;
      if (remainingSize > 1e-8) {
        updatedPositions.push({
          ...position,
          size: remainingSize,
          margin: position.margin - marginPortion,
          slPrice: position.slPrice,
          tpPrice: position.tpPrice,
        });
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

  function checkOrders(candle: Candle) {
    if (!candle) return;
    const snapshot = [...openPositions.value];
    for (const position of snapshot) {
      const executionPrice = evaluateTriggers(position, candle);
      if (executionPrice !== null) {
        closePositions(position.side, position.size, executionPrice, candle.time, {
          positionId: position.id,
        });
      }
    }
  }

  function evaluateTriggers(position: Position, candle: Candle): number | null {
    const { slPrice, tpPrice, side } = position;
    const { high, low } = candle;

    if (side === "long") {
      if (slPrice && low <= slPrice) {
        return slPrice;
      }
      if (tpPrice && high >= tpPrice) {
        return tpPrice;
      }
    } else {
      if (slPrice && high >= slPrice) {
        return slPrice;
      }
      if (tpPrice && low <= tpPrice) {
        return tpPrice;
      }
    }

    return null;
  }

  function calculateMargin(size: number, price: number) {
    if (size <= 0 || price <= 0) return 0;
    return (size * price) / leverage.value;
  }

  function getMarginRequirement(size: number, price: number) {
    return calculateMargin(size, price);
  }

  function setLeverage(value: number) {
    const normalized = Math.min(
      MAX_LEVERAGE,
      Math.max(MIN_LEVERAGE, Math.round(value))
    );
    leverage.value = normalized;
  }

  function sanitizeLevel(value?: number | null) {
    if (!value || value <= 0) return null;
    return value;
  }

  return {
    startingBalance: STARTING_BALANCE,
    cashBalance,
    availableBalance,
    openPositions,
    tradeHistory,
    realizedPnL,
    leverage,
    minLeverage: MIN_LEVERAGE,
    maxLeverage: MAX_LEVERAGE,
    marketBuy,
    marketSell,
    closePosition,
    closeAllPositions,
    checkOrders,
    totalOpenSize,
    getUnrealizedPnL,
    getEquity,
    tradeMarkers,
    setLeverage,
    getMarginRequirement,
  };
});
