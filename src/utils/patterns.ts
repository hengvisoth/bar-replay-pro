import type { Candle } from "../data/types";

function getBodySize(candle: Candle) {
  return Math.abs((candle.close ?? 0) - (candle.open ?? 0));
}

function getUpperShadow(candle: Candle) {
  const high = candle.high ?? 0;
  const upperBody = Math.max(candle.open ?? 0, candle.close ?? 0);
  return high - upperBody;
}

function getLowerShadow(candle: Candle) {
  const low = candle.low ?? 0;
  const lowerBody = Math.min(candle.open ?? 0, candle.close ?? 0);
  return lowerBody - low;
}

export function isBullishEngulfing(current: Candle, previous: Candle) {
  const currentOpen = current.open ?? 0;
  const currentClose = current.close ?? 0;
  const previousOpen = previous.open ?? 0;
  const previousClose = previous.close ?? 0;

  const isCurrentBullish = currentClose > currentOpen;
  const isPreviousBearish = previousClose < previousOpen;

  const fullyEngulfs =
    currentOpen <= previousClose && currentClose >= previousOpen;

  const currentBody = getBodySize(current);
  const previousBody = getBodySize(previous);
  const hasMeaningfulSize = currentBody > 0 && previousBody > 0;

  return isCurrentBullish && isPreviousBearish && fullyEngulfs && hasMeaningfulSize;
}

export function isHammer(candle: Candle) {
  const body = getBodySize(candle);
  if (body <= 0) return false;

  const lowerShadow = getLowerShadow(candle);
  const upperShadow = getUpperShadow(candle);

  const hasLongLowerShadow = lowerShadow >= body * 2;
  const hasSmallUpperShadow = upperShadow <= body * 0.35;

  return hasLongLowerShadow && hasSmallUpperShadow;
}
