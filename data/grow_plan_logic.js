/**
 * Pure grow-plan helpers for the Page and a later mobile/PWA app.
 * No DOM, no storage, no network. Dates are calendar dates in the
 * user's local timezone (YYYY-MM-DD), not UTC instants.
 */

/**
 * @param {string} iso
 * @returns {Date | null} local midnight, or null if invalid
 */
export function parseISODate(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD in local time
 */
export function toISODate(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const da = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/**
 * Whole calendar days from start to `now` (local dates).
 * Start date is day 0; the next calendar day is 1.
 * @param {string} startISO
 * @param {Date} now
 * @returns {number | null}
 */
export function daysSinceStart(startISO, now) {
  const start = parseISODate(startISO);
  if (!start || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - start.getTime()) / 86400000);
}

/**
 * @typedef {"no-date" | "upcoming" | "active" | "past"} CycleStatus
 * @typedef {{ status: CycleStatus, weekIndex: number, dayNumber: number | null, weekCount: number }} CycleProgress
 *
 * weekIndex is always clamped to 0..weekCount-1 so a UI can still show
 * the first or last week. status tells the caller whether that index is
 * actually "now".
 *
 * @param {string} startISO
 * @param {Date} now
 * @param {number} weekCount
 * @returns {CycleProgress}
 */
export function getCycleProgress(startISO, now, weekCount) {
  const count = Math.max(1, Math.floor(weekCount) || 1);
  const days = daysSinceStart(startISO, now);
  if (days === null) {
    return { status: "no-date", weekIndex: 0, dayNumber: null, weekCount: count };
  }
  if (days < 0) {
    return { status: "upcoming", weekIndex: 0, dayNumber: days, weekCount: count };
  }
  const rawIndex = Math.floor(days / 7);
  if (rawIndex >= count) {
    return { status: "past", weekIndex: count - 1, dayNumber: days + 1, weekCount: count };
  }
  return { status: "active", weekIndex: rawIndex, dayNumber: days + 1, weekCount: count };
}

/**
 * @param {string} startISO
 * @param {number} weekIndex
 * @returns {{ start: string, end: string } | null}
 */
export function weekDateRange(startISO, weekIndex) {
  const start = parseISODate(startISO);
  if (!start || weekIndex < 0) return null;
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weekIndex * 7);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  return { start: toISODate(from), end: toISODate(to) };
}

/**
 * @param {string} startISO
 * @param {number} weekIndex
 * @param {Date} now
 * @param {number} weekCount
 * @returns {boolean}
 */
export function isCurrentWeek(startISO, weekIndex, now, weekCount) {
  const progress = getCycleProgress(startISO, now, weekCount);
  return progress.status === "active" && progress.weekIndex === weekIndex;
}

/**
 * @param {number} n
 * @param {number} [decimals]
 * @returns {number}
 */
export function roundDose(n, decimals) {
  const d = decimals == null ? 2 : decimals;
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Mix one product for a tank size.
 * If min and max are set (Athena CaMg / Cleanse ranges), totalMin/totalMax
 * are filled and amount is the midpoint unless amountPerL is also set.
 *
 * @param {{ name: string, unit: "ml/L" | "g/L", amountPerL?: number | null, minPerL?: number | null, maxPerL?: number | null }} product
 * @param {number} liters
 * @returns {{ name: string, unit: "ml" | "g", amountPerL: number | null, minPerL: number | null, maxPerL: number | null, total: number | null, totalMin: number | null, totalMax: number | null } | null}
 */
export function mixProduct(product, liters) {
  const L = Number(liters);
  if (!Number.isFinite(L) || L <= 0) return null;
  const unit = product.unit === "g/L" ? "g" : "ml";
  const min = product.minPerL == null ? null : Number(product.minPerL);
  const max = product.maxPerL == null ? null : Number(product.maxPerL);
  const hasRange = min != null && max != null && Number.isFinite(min) && Number.isFinite(max);
  let per = product.amountPerL == null ? null : Number(product.amountPerL);
  if (per != null && !Number.isFinite(per)) per = null;
  if (per == null && hasRange) per = (min + max) / 2;
  if (per == null && !hasRange) return null;
  if (per === 0 && !hasRange) return null;
  if (hasRange && min === 0 && max === 0) return null;
  return {
    name: product.name,
    unit,
    amountPerL: per == null ? null : roundDose(per),
    minPerL: hasRange ? roundDose(min) : null,
    maxPerL: hasRange ? roundDose(max) : null,
    total: per == null ? null : roundDose(per * L),
    totalMin: hasRange ? roundDose(min * L) : null,
    totalMax: hasRange ? roundDose(max * L) : null,
  };
}

/**
 * @param {Array<{ name: string, unit: "ml/L" | "g/L", amountPerL?: number | null, minPerL?: number | null, maxPerL?: number | null }>} products
 * @param {number} liters
 */
export function mixRecipe(products, liters) {
  const rows = [];
  for (const product of products) {
    const row = mixProduct(product, liters);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Pull the products to mix for one week from a user/preset plan.
 * @param {{ products: Array<{ id: string, name: string, unit: "ml/L" | "g/L", doses: Array<number|null|undefined>, ranges?: Array<[number, number]|null|undefined> }> }} plan
 * @param {number} weekIndex
 * @param {number} liters
 * @returns {ReturnType<typeof mixRecipe>}
 */
export function mixPlanWeek(plan, weekIndex, liters) {
  const products = (plan && plan.products) || [];
  const mapped = products.map((p) => {
    const dose = Array.isArray(p.doses) ? p.doses[weekIndex] : null;
    const range = Array.isArray(p.ranges) ? p.ranges[weekIndex] : null;
    return {
      name: p.name,
      unit: p.unit === "g/L" ? "g/L" : "ml/L",
      amountPerL: dose == null || dose === "" ? null : Number(dose),
      minPerL: range && range[0] != null ? Number(range[0]) : null,
      maxPerL: range && range[1] != null ? Number(range[1]) : null,
    };
  });
  return mixRecipe(mapped, liters);
}

/**
 * German display for a mixed amount, e.g. "29 ml" or "8–13 ml".
 * @param {{ unit: string, total: number | null, totalMin: number | null, totalMax: number | null }} row
 * @returns {string}
 */
export function formatMixAmount(row) {
  if (row.totalMin != null && row.totalMax != null) {
    return `${formatNumber(row.totalMin)}–${formatNumber(row.totalMax)} ${row.unit}`;
  }
  if (row.total == null) return "—";
  return `${formatNumber(row.total)} ${row.unit}`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  const rounded = roundDose(n);
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(".", ",");
}
