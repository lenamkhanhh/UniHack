/**
 * Unified Formatting & Currency Utilities
 * WOW-F14: Ensures numbers and USDC currency metrics are formatted consistently
 * across API, UI components, and stage views without ever producing NaN, $NaN, or crashing.
 */

export function formatUsdc(
  val: string | number | bigint | null | undefined,
  fallback = '0.00'
): string {
  if (val === null || val === undefined) return fallback;

  if (typeof val === 'bigint') {
    try {
      const num = Number(val) / 1e6;
      return Number.isFinite(num) ? num.toFixed(2) : fallback;
    } catch {
      return fallback;
    }
  }

  if (typeof val === 'number') {
    return Number.isFinite(val) ? val.toFixed(2) : fallback;
  }

  const str = String(val).trim();
  if (
    !str ||
    str.toLowerCase() === 'nan' ||
    str.toLowerCase() === 'undefined' ||
    str.toLowerCase() === 'null' ||
    str === '—'
  ) {
    return fallback;
  }

  // Remove currency symbols or non-numeric characters except minus and period
  const cleaned = str.replace(/[^0-9.-]/g, '');
  if (!cleaned) return fallback;

  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : fallback;
}

export function formatSafeNumber(
  val: number | string | null | undefined,
  fallback = 0
): number {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  const parsed = parseInt(String(val), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
