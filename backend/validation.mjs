export const MAX_QUANTITY = 2147483647;
export const MAX_PRICE = 9999999999.99;

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function nonNegativeInt(value) {
  const n = numeric(value);
  return n !== null && Number.isSafeInteger(n) && n >= 0 && n <= MAX_QUANTITY ? n : null;
}

export function positiveInt(value) {
  const n = nonNegativeInt(value);
  return n !== null && n > 0 ? n : null;
}

export function priceValue(value) {
  const n = numeric(value);
  if (n === null || n < 0 || n > MAX_PRICE) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
