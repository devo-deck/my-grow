/**
 * App-specific pure functions. No DOM, no storage.
 * Complements data/grow_plan_logic.js
 */

import { daysSinceStart, parseISODate, toISODate, getCycleProgress } from "../data/grow_plan_logic.js";

export const PHASES = {
  start: { id: "start", label: "Start" },
  veg: { id: "veg", label: "Wachstum" },
  flower: { id: "flower", label: "Blüte" },
  flush: { id: "flush", label: "Spülen" },
  harvest: { id: "harvest", label: "Ernte" },
};

/** Flip to flower is planned at the start of week index 5 (day 35). */
export const FLOWER_START_DAY = 35;
/** 14 weeks: days 0–97. Last 3 calendar days of the last week are 95–97. */
export const FLUSH_START_DAY = 95;
export const HARVEST_DAY = 98;

/** Planned cycle length in calendar days (14 weeks: days 0–97, harvest at day 98). */
export const CYCLE_DAYS = HARVEST_DAY;

/**
 * Total duration and remaining time for the 14-week plan.
 * remainingDays counts whole calendar days until local midnight of the harvest day.
 */
export function cycleOverview(startISO, now, weekCount = 14, flipISO) {
  const plannedDays = weekCount * 7;
  const totalWeeks = weekCount;
  const start = parseISODate(startISO);
  const totalDays = start ? harvestDayOffset(startISO, flipISO) : plannedDays;
  const harvestAt = start
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + totalDays)
    : null;
  const days = daysSinceStart(startISO, now);
  if (days === null) {
    return { status: "no-date", totalDays, totalWeeks, elapsedDays: null, remainingDays: totalDays, dayNumber: null, pct: 0, harvestAt };
  }
  if (days < 0) {
    return { status: "upcoming", totalDays, totalWeeks, elapsedDays: 0, remainingDays: totalDays, dayNumber: null, pct: 0, startsIn: -days, harvestAt };
  }
  if (days >= totalDays) {
    return { status: "done", totalDays, totalWeeks, elapsedDays: totalDays, remainingDays: 0, dayNumber: totalDays, pct: 100, harvestAt };
  }
  return {
    status: "active",
    totalDays,
    totalWeeks,
    elapsedDays: days,
    remainingDays: totalDays - days,
    dayNumber: days + 1,
    pct: Math.round((days / totalDays) * 100),
    harvestAt,
  };
}


export function phaseIdForWeek(week) {
  if (!week) return "start";
  if (week.phase === "start") return "start";
  if (week.phase === "veg") return "veg";
  if (week.phase === "flower") return "flower";
  return week.phase || "start";
}

/**
 * Calendar phase including flush / harvest after the 14-week plan.
 * @param {string} startISO
 * @param {Date} now
 * @param {number} [weekCount=14]
 */
export function currentPhase(startISO, now, weekCount = 14, flipISO) {
  const days = daysSinceStart(startISO, now);
  if (days === null) return { id: "none", label: "Kein Start", dayIndex: null };
  if (days < 0) return { id: "upcoming", label: "Start geplant", dayIndex: days };
  const flower = flowerStartDay(startISO, flipISO);
  const flush = flushDayOffset(startISO, flipISO);
  const harvest = harvestDayOffset(startISO, flipISO);
  if (days >= harvest) return { id: "harvest", label: "Ernte", dayIndex: days };
  if (days >= flush) return { id: "flush", label: "Spülen", dayIndex: days };
  if (days >= flower) return { id: "flower", label: "Blüte", dayIndex: days };
  if (days >= 7) return { id: "veg", label: "Wachstum", dayIndex: days };
  return { id: "start", label: "Start", dayIndex: days };
}

/**
 * Next phase change after `now`, as a local-midnight Date.
 * @returns {{ id: string, label: string, at: Date, atDay: number } | null}
 */
export function nextPhaseEvent(startISO, now, weekCount = 14, flipISO) {
  const start = parseISODate(startISO);
  if (!start || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const days = daysSinceStart(startISO, now);
  const flower = flowerStartDay(startISO, flipISO);
  const flush = flushDayOffset(startISO, flipISO);
  const harvest = harvestDayOffset(startISO, flipISO);
  const events = [{ atDay: 0, id: "start", label: "Start" }];
  if (flower > 7) events.push({ atDay: 7, id: "veg", label: "Wachstum" });
  events.push({ atDay: flower, id: "flower", label: "Blüte" });
  events.push({ atDay: flush, id: "flush", label: "Spülen" });
  events.push({ atDay: harvest, id: "harvest", label: "Ernte" });
  const cursor = days == null ? -Infinity : days;
  for (const ev of events) {
    if (ev.atDay > cursor) {
      const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + ev.atDay);
      return { ...ev, at };
    }
  }
  return null;
}

/**
 * @param {Date} target
 * @param {Date} now
 */
export function countdownParts(target, now) {
  if (!(target instanceof Date) || !(now instanceof Date)) {
    return { totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0, overdue: true };
  }
  const totalMs = target.getTime() - now.getTime();
  if (totalMs <= 0) {
    return { totalMs, days: 0, hours: 0, minutes: 0, seconds: 0, overdue: true };
  }
  const sec = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(sec / 86400),
    hours: Math.floor((sec % 86400) / 3600),
    minutes: Math.floor((sec % 3600) / 60),
    seconds: sec % 60,
    overdue: false,
  };
}

/**
 * Days between waterings, based on substrate and phase.
 * Soil stays wet longer than coco.
 */
export function wateringIntervalDays(substrate, phaseId) {
  const kind = substrate === "kokos" ? "kokos" : substrate === "erde" ? "erde" : "custom";
  if (kind === "kokos") {
    if (phaseId === "start" || phaseId === "upcoming") return 2;
    return 1;
  }
  if (kind === "erde") {
    if (phaseId === "flower" || phaseId === "flush") return 2;
    return 3;
  }
  return 2;
}

/**
 * @param {string[]} waterings ISO dates, any order
 * @param {string} todayISO
 * @param {number} intervalDays
 */
export function wateringStatus(waterings, todayISO, intervalDays) {
  const today = parseISODate(todayISO);
  const interval = Math.max(1, Math.floor(intervalDays) || 1);
  if (!today) {
    return { waterToday: false, nextISO: null, lastISO: null, daysSince: null };
  }
  const dates = (waterings || [])
    .map((d) => parseISODate(d))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
  const last = dates.length ? dates[dates.length - 1] : null;
  if (!last) {
    return { waterToday: true, nextISO: todayISO, lastISO: null, daysSince: null };
  }
  const lastISO = toISODate(last);
  const daysSince = Math.round((today.getTime() - last.getTime()) / 86400000);
  const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + interval);
  const nextISO = toISODate(next);
  const waterToday = daysSince >= interval;
  return {
    waterToday,
    nextISO: waterToday ? todayISO : nextISO,
    lastISO,
    daysSince,
  };
}

export function addWatering(waterings, todayISO) {
  const list = Array.isArray(waterings) ? waterings.slice() : [];
  if (!parseISODate(todayISO)) return list;
  if (list.includes(todayISO)) return list;
  list.push(todayISO);
  list.sort();
  return list;
}

/**
 * Average PPFD estimate at the canopy for a given dim level.
 * utilization < 1 accounts for wall/floor losses in a tent.
 * This is not a measured map and ignores the inverse-square error of bar LEDs.
 */
export function estimatePPFD(ppf, dimPct, areaM2, utilization = 0.85) {
  const p = Number(ppf);
  const dim = Number(dimPct);
  const area = Number(areaM2);
  const u = Number(utilization);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(area) || area <= 0) return null;
  const d = Number.isFinite(dim) ? Math.min(100, Math.max(0, dim)) / 100 : 1;
  const util = Number.isFinite(u) && u > 0 ? Math.min(1, u) : 0.85;
  return Math.round(p * d * util / area);
}

export function lampPPF(lamp) {
  if (!lamp) return null;
  if (lamp.ppf && Number(lamp.ppf) > 0) return Number(lamp.ppf);
  const w = Number(lamp.watts);
  const eff = Number(lamp.umolPerJ);
  if (w > 0 && eff > 0) return w * eff;
  return null;
}

export function snapToDimStep(value, dimSteps) {
  const steps = (dimSteps && dimSteps.length ? dimSteps : [0, 25, 50, 75, 100])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!steps.length) return Math.max(0, Math.min(100, Math.round(value)));
  let best = steps[0];
  let bestDiff = Math.abs(steps[0] - value);
  for (const s of steps) {
    const diff = Math.abs(s - value);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Recommend dim (snapped to steps) and hang height for a phase,
 * aiming at the mid-point of the PPFD target range.
 * Optional opts: { type, ppfdRef, tentHeightM }.
 * If manufacturer PPFD or PAR readings exist, those are interpolated
 * by height and dim and used instead of the raw PPF model.
 */
export function recommendLampSetup(lamp, areaM2, targetPpf, hangCmRange, dimSteps, opts = {}) {
  const typeId = (opts && opts.type) || (lamp && lamp.type) || "bar";
  const baseHang = Array.isArray(hangCmRange) && hangCmRange.length ? hangCmRange : [40, 50];
  const hang = adjustHangRange(baseHang, typeId, opts && opts.tentHeightM);
  const midHang = Math.round((Number(hang[0]) + Number(hang[hang.length - 1])) / 2);
  const refHang = Math.round((Number(baseHang[0]) + Number(baseHang[baseHang.length - 1])) / 2);
  const mid = Array.isArray(targetPpf)
    ? (Number(targetPpf[0]) + Number(targetPpf[targetPpf.length - 1])) / 2
    : Number(targetPpf);
  const query = {
    lamp,
    areaM2,
    heightCm: midHang,
    refHeightCm: refHang,
    type: typeId,
    ppfdRef: opts && opts.ppfdRef,
  };
  const at100 = estimatePPFDAt({ ...query, dimPct: 100 });
  let dim = 100;
  if (at100 && at100.ppfdAvg > 0 && mid > 0) {
    dim = snapToDimStep((mid / at100.ppfdAvg) * 100, dimSteps || (lamp && lamp.dimSteps));
  }
  const estimated = estimatePPFDAt({ ...query, dimPct: dim });
  return {
    dimPct: dim,
    hangCm: hang,
    hangCmMid: midHang,
    ppfdEstimate: estimated ? estimated.ppfdAvg : null,
    ppfdCenter: estimated ? estimated.ppfdCenter : null,
    ppfdEdge: estimated ? estimated.ppfdEdge : null,
    ppfdAtFull: at100 ? at100.ppfdAvg : null,
    targetMid: Number.isFinite(mid) ? mid : null,
    source: estimated ? estimated.source : "ppf",
    type: typeId,
  };
}

export function tentAreaM2(tent) {
  if (!tent) return null;
  const w = Number(tent.widthM);
  const l = Number(tent.lengthM);
  if (!Number.isFinite(w) || !Number.isFinite(l) || w <= 0 || l <= 0) return null;
  return w * l;
}

export const OMEGA_LAMP = {
  id: "omega-infinity-600-pro-3",
  name: "Omega Infinity 600W Pro 3.0",
  type: "bar",
  watts: 600,
  ppf: 1890,
  umolPerJ: 3.0,
  widthM: 1.182,
  lengthM: 1.091,
  dimSteps: [0, 25, 50, 75, 100],
  hangCm: {
    start: [60, 70],
    veg: [60, 70],
    flower: [40, 50],
    flush: [40, 50],
    harvest: [40, 50],
  },
};

export const LAMP_PRESETS = [OMEGA_LAMP];

export function resolveLamp(grow) {
  const type = (grow && grow.lampType) || (grow && grow.lampId === "custom" && grow.customLamp && grow.customLamp.type) || "bar";
  if (grow && grow.lampId === "custom" && grow.customLamp) {
    const c = grow.customLamp;
    return {
      id: "custom",
      name: c.name || "Eigene Lampe",
      type: c.type || type || "bar",
      watts: Number(c.watts) || 0,
      ppf: Number(c.ppf) || 0,
      umolPerJ: Number(c.umolPerJ) || 0,
      widthM: Number(c.widthM) || 0,
      lengthM: Number(c.lengthM) || 0,
      dimSteps: Array.isArray(c.dimSteps) && c.dimSteps.length ? c.dimSteps.map(Number) : [0, 25, 50, 75, 100],
      hangCm: c.hangCm || OMEGA_LAMP.hangCm,
    };
  }
  const found = LAMP_PRESETS.find((l) => grow && l.id === grow.lampId);
  const lamp = found || OMEGA_LAMP;
  return { ...lamp, type: type || lamp.type || "bar" };
}

export function emptyPlan(weekCount = 14) {
  return {
    schemaVersion: 1,
    name: "Eigener Plan",
    presetId: "custom",
    products: [],
    weekTargets: Array.from({ length: weekCount }, () => ({ ec: null, pH: "" })),
  };
}

export function defaultGrow(overrides = {}) {
  return {
    id: overrides.id || `g-${Date.now()}`,
    name: overrides.name || "Mein Grow",
    startDate: overrides.startDate || "",
    plants: overrides.plants != null ? Number(overrides.plants) : 3,
    tent: overrides.tent || { widthM: 1.2, lengthM: 1.2, heightM: 2 },
    substrate: overrides.substrate || "erde",
    substrateCustom: overrides.substrateCustom || "",
    potL: overrides.potL != null ? Number(overrides.potL) : 25,
    tankL: overrides.tankL != null ? Number(overrides.tankL) : 10,
    lampId: overrides.lampId || OMEGA_LAMP.id,
    lampType: overrides.lampType || "bar",
    customLamp: overrides.customLamp || null,
    ppfdRef: normalizePpfdRef(overrides.ppfdRef),
    flipDate: overrides.flipDate || "",
    plan: overrides.plan || null,
    waterings: Array.isArray(overrides.waterings) ? overrides.waterings.slice() : [],
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: overrides.updatedAt || new Date().toISOString(),
  };
}

export function exportPayload(grows, activeId) {
  return {
    schemaVersion: 1,
    kind: "devrim-grow-app",
    exportedAt: new Date().toISOString(),
    activeId: activeId || null,
    grows: grows || [],
  };
}

export function parseExport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.grows)) {
    return { grows: raw.grows, activeId: typeof raw.activeId === "string" ? raw.activeId : raw.grows[0]?.id || null };
  }
  if (raw.plan || raw.startDate || raw.name) {
    const grow = defaultGrow(raw.grow && typeof raw.grow === "object" ? { ...raw, ...raw.grow } : raw);
    if (raw.plan) grow.plan = raw.plan;
    if (raw.startDate) grow.startDate = raw.startDate;
    if (raw.name) grow.name = raw.name;
    return { grows: [grow], activeId: grow.id };
  }
  return null;
}

/** Planned flower / flush / harvest offsets shift if an actual 12/12 date is set. */
export function flowerStartDay(startISO, flipISO) {
  if (flipISO && startISO) {
    const start = parseISODate(startISO);
    const flip = parseISODate(flipISO);
    if (start && flip) {
      const d = Math.round((flip.getTime() - start.getTime()) / 86400000);
      if (Number.isFinite(d) && d >= 0 && d <= 140) return d;
    }
  }
  return FLOWER_START_DAY;
}

export function flushDayOffset(startISO, flipISO) {
  return flowerStartDay(startISO, flipISO) + (FLUSH_START_DAY - FLOWER_START_DAY);
}

export function harvestDayOffset(startISO, flipISO) {
  return flowerStartDay(startISO, flipISO) + (HARVEST_DAY - FLOWER_START_DAY);
}

export function addDaysISO(startISO, days) {
  const start = parseISODate(startISO);
  if (!start || !Number.isFinite(Number(days))) return null;
  const d = Number(days);
  return toISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d));
}

/**
 * Day ranges for the 14 plan weeks. Veg weeks 0–4 cover [0, flipDay).
 * Late flip extends week 4 (stay on the last veg recipe). Early flip leaves trailing veg weeks unused.
 * Flower weeks 5–13 are always 7 days from the flip.
 */
export function weekDayRanges(flipDay, weekCount = 14) {
  const vegN = 5;
  const flowerN = Math.max(0, weekCount - vegN);
  const flip = Number.isFinite(Number(flipDay)) ? Math.max(0, Math.round(Number(flipDay))) : FLOWER_START_DAY;
  const ranges = [];
  let cursor = 0;
  for (let i = 0; i < vegN; i += 1) {
    const remaining = flip - cursor;
    if (remaining <= 0) {
      ranges.push(null);
      continue;
    }
    if (i < vegN - 1) {
      const len = Math.min(7, remaining);
      ranges.push({ startDay: cursor, endDay: cursor + len - 1 });
      cursor += len;
    } else {
      ranges.push({ startDay: cursor, endDay: flip - 1 });
    }
  }
  for (let i = 0; i < flowerN; i += 1) {
    const startDay = flip + i * 7;
    ranges.push({ startDay, endDay: startDay + 6 });
  }
  return ranges;
}

export function weekIndexForDay(day, flipDay, weekCount = 14) {
  const ranges = weekDayRanges(flipDay, weekCount);
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i];
    if (r && day >= r.startDay && day <= r.endDay) return i;
  }
  if (day < 0) return 0;
  return Math.max(0, weekCount - 1);
}

/** Like getCycleProgress, but veg/flower week borders follow the actual 12/12 date. */
export function getGrowProgress(startISO, now, weekCount = 14, flipISO) {
  const count = Math.max(1, Math.floor(weekCount) || 1);
  const days = daysSinceStart(startISO, now);
  if (days === null) return { status: "no-date", weekIndex: 0, dayNumber: null, weekCount: count };
  if (days < 0) return { status: "upcoming", weekIndex: 0, dayNumber: days, weekCount: count };
  const harvest = harvestDayOffset(startISO, flipISO);
  if (days >= harvest) return { status: "past", weekIndex: count - 1, dayNumber: days + 1, weekCount: count };
  return {
    status: "active",
    weekIndex: weekIndexForDay(days, flowerStartDay(startISO, flipISO), count),
    dayNumber: days + 1,
    weekCount: count,
  };
}

export function growWeekDateRange(startISO, weekIndex, flipISO) {
  const start = parseISODate(startISO);
  if (!start || weekIndex < 0) return null;
  const r = weekDayRanges(flowerStartDay(startISO, flipISO))[weekIndex];
  if (!r) return null;
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r.startDay);
  const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r.endDay);
  return { start: toISODate(from), end: toISODate(to), startDay: r.startDay, endDay: r.endDay };
}

export function tasksForWeek(week, substrate) {
  const tasks = Array.isArray(week && week.tasks) ? week.tasks : [];
  return tasks.map((t) => adaptTask(t, substrate)).filter(Boolean);
}

function adaptTask(text, substrate) {
  const t = String(text || "");
  const kind = substrate === "kokos" ? "kokos" : substrate === "erde" ? "erde" : "custom";
  if (t.startsWith("Kokos voreinweichen")) {
    if (kind === "kokos") return t;
    if (kind === "erde") return "Erde vor dem Einsetzen leicht anfeuchten, nicht durchnässen. Kein Kokos-Voreinweichen.";
    return "Substrat vor dem Einsetzen nach Herstellerangabe vorbereiten. Kokos-Voreinweichen nur bei Kokos.";
  }
  if (t.startsWith("Letzte 3 Tage in Kokos:")) {
    if (kind === "kokos") return t;
    if (kind === "erde") return "Letzte 3 Tage: mit klarem, weichem Wasser spülen (ohne Dünger), pH 6,0–6,4. Cleanse 2,6 ml/L ist optional. Ernten, wenn die Sorte reif ist.";
    return "Letzte 3 Tage: mit klarem, weichem Wasser spülen, pH 6,0–6,4. Bei Kokos: Umkehrosmose plus Athena Cleanse 2,6 ml/L, EC unter 0,1.";
  }
  return t;
}

export const LAMP_TYPES = {
  bar: {
    id: "bar",
    label: "Fläche / Leisten",
    short: "Fläche",
    hangShiftCm: 0,
    utilization: 0.85,
    edgeRatio: 0.9,
    falloff: 0.6,
    blurb: "Gleichmäßiges Licht, darf etwas tiefer hängen.",
  },
  panel: {
    id: "panel",
    label: "Panel",
    short: "Panel",
    hangShiftCm: 10,
    utilization: 0.75,
    edgeRatio: 0.7,
    falloff: 1,
    blurb: "Mittlere Streuung, etwas höher als Leisten.",
  },
  spot: {
    id: "spot",
    label: "Spot (COB)",
    short: "Spot",
    hangShiftCm: 25,
    utilization: 0.6,
    edgeRatio: 0.45,
    falloff: 1.6,
    blurb: "Hotspot in der Mitte, Rand dunkler — höher hängen.",
  },
};

export const LAMP_TYPE_LIST = [LAMP_TYPES.bar, LAMP_TYPES.panel, LAMP_TYPES.spot];

export function lampTypeInfo(typeId) {
  return LAMP_TYPES[typeId] || LAMP_TYPES.bar;
}

export function adjustHangRange(baseRange, typeId, tentHeightM) {
  const base = Array.isArray(baseRange) && baseRange.length ? baseRange.map(Number) : [40, 50];
  const lo0 = Number.isFinite(base[0]) ? base[0] : 40;
  const hi0 = Number.isFinite(base[base.length - 1]) ? base[base.length - 1] : lo0;
  const shift = lampTypeInfo(typeId).hangShiftCm || 0;
  const maxH = tentHeightM && Number(tentHeightM) > 0 ? Math.floor(Number(tentHeightM) * 100 - 20) : 200;
  const minH = 20;
  const clamp = (n) => Math.max(minH, Math.min(maxH, Math.round(n)));
  let lo = clamp(lo0 + shift);
  let hi = clamp(hi0 + shift);
  if (lo > hi) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }
  return [lo, hi];
}

export function heightFactor(typeId, heightCm, refHeightCm) {
  const h = Number(heightCm);
  const ref = Number(refHeightCm);
  if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(ref) || ref <= 0) return 1;
  const falloff = lampTypeInfo(typeId).falloff;
  return Math.pow(ref / Math.max(10, h), falloff);
}

export function emptyPpfdRef() {
  return { manufacturer: [], readings: [] };
}

export function normalizePpfdRef(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const clean = (list) => (Array.isArray(list) ? list.map((row) => ({ ...row })) : []);
  return { manufacturer: clean(src.manufacturer), readings: clean(src.readings) };
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pointAverage(row) {
  if (!row) return null;
  const avg = numOrNull(row.ppfdAvg);
  if (avg != null && avg > 0) return avg;
  const c = numOrNull(row.ppfdCenter);
  const e = numOrNull(row.ppfdEdge);
  if (c != null && c > 0 && e != null && e > 0) return (c + e) / 2;
  if (c != null && c > 0) return c;
  if (e != null && e > 0) return e;
  return null;
}

function usablePpfdPoints(list, areaM2) {
  const out = [];
  for (const row of list || []) {
    const heightCm = numOrNull(row.heightCm);
    const avg = pointAverage(row);
    if (heightCm == null || heightCm <= 0 || avg == null || avg <= 0) continue;
    const dim = numOrNull(row.dimPct);
    const dimFrac = dim != null && dim > 0 ? Math.min(100, dim) / 100 : 1;
    const area = numOrNull(row.areaM2);
    const areaScale = area != null && area > 0 && areaM2 > 0 ? area / areaM2 : 1;
    const scale = (areaScale / dimFrac);
    const center = numOrNull(row.ppfdCenter);
    const edge = numOrNull(row.ppfdEdge);
    out.push({
      heightCm,
      avg100: avg * scale,
      center100: center != null && center > 0 ? center * scale : null,
      edge100: edge != null && edge > 0 ? edge * scale : null,
    });
  }
  out.sort((a, b) => a.heightCm - b.heightCm);
  return out;
}

function interpolateValue(points, key, heightCm) {
  const pts = (points || []).filter((p) => p[key] != null && p[key] > 0);
  if (!pts.length) return { value: null, single: false, refHeight: null };
  const h = Number(heightCm);
  if (!Number.isFinite(h)) return { value: pts[0][key], single: pts.length === 1, refHeight: pts[0].heightCm };
  if (pts.length === 1) return { value: pts[0][key], single: true, refHeight: pts[0].heightCm };
  if (h <= pts[0].heightCm) {
    const a = pts[0];
    const b = pts[1];
    const t = (h - a.heightCm) / (b.heightCm - a.heightCm);
    return { value: a[key] + t * (b[key] - a[key]), single: false, refHeight: null };
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (h <= b.heightCm) {
      const t = (h - a.heightCm) / (b.heightCm - a.heightCm);
      return { value: a[key] + t * (b[key] - a[key]), single: false, refHeight: null };
    }
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const t = (h - a.heightCm) / (b.heightCm - a.heightCm);
  return { value: a[key] + t * (b[key] - a[key]), single: false, refHeight: null };
}

function fromPoints(points, heightCm, dimPct, typeId, source) {
  const dim = Number.isFinite(Number(dimPct)) ? Math.min(100, Math.max(0, Number(dimPct))) / 100 : 1;
  const avgI = interpolateValue(points, "avg100", heightCm);
  if (avgI.value == null) return null;
  let avg100 = avgI.value;
  if (avgI.single) avg100 *= heightFactor(typeId, heightCm, avgI.refHeight);
  const centerI = interpolateValue(points, "center100", heightCm);
  const edgeI = interpolateValue(points, "edge100", heightCm);
  let center100 = centerI.value;
  let edge100 = edgeI.value;
  if (centerI.single && center100 != null) center100 *= heightFactor(typeId, heightCm, centerI.refHeight);
  if (edgeI.single && edge100 != null) edge100 *= heightFactor(typeId, heightCm, edgeI.refHeight);
  const avg = Math.max(0, Math.round(avg100 * dim));
  const center = center100 != null ? Math.max(0, Math.round(center100 * dim)) : null;
  const edge = edge100 != null ? Math.max(0, Math.round(edge100 * dim)) : null;
  return { ppfdAvg: avg, ppfdCenter: center, ppfdEdge: edge, source };
}

/**
 * PPFD at a height and dim level.
 * Prefers PAR readings, then manufacturer points, then the PPF tent model.
 * Values are estimates (or interpolations) — not a measured map.
 */
export function estimatePPFDAt(opts = {}) {
  const lamp = opts.lamp;
  const areaM2 = Number(opts.areaM2);
  const dimPct = opts.dimPct;
  const heightCm = numOrNull(opts.heightCm);
  const typeId = opts.type || (lamp && lamp.type) || "bar";
  const info = lampTypeInfo(typeId);
  const ref = normalizePpfdRef(opts.ppfdRef);
  const readings = usablePpfdPoints(ref.readings, areaM2);
  if (readings.length) {
    const from = fromPoints(readings, heightCm, dimPct, typeId, "reading");
    if (from) return from;
  }
  const mfr = usablePpfdPoints(ref.manufacturer, areaM2);
  if (mfr.length) {
    const from = fromPoints(mfr, heightCm, dimPct, typeId, "manufacturer");
    if (from) {
      if (from.ppfdCenter == null && from.ppfdEdge == null && from.ppfdAvg != null) {
        const mid = (1 + info.edgeRatio) / 2;
        const center = mid > 0 ? Math.round(from.ppfdAvg / mid) : from.ppfdAvg;
        from.ppfdCenter = center;
        from.ppfdEdge = Math.round(center * info.edgeRatio);
      }
      return from;
    }
  }
  const ppf = lampPPF(lamp);
  const atRef = estimatePPFD(ppf, dimPct, areaM2, info.utilization);
  if (atRef == null) return null;
  const refH = numOrNull(opts.refHeightCm) != null ? Number(opts.refHeightCm) : heightCm;
  const factor = heightCm != null ? heightFactor(typeId, heightCm, refH) : 1;
  const avg = Math.max(0, Math.round(atRef * factor));
  const mid = (1 + info.edgeRatio) / 2;
  const center = mid > 0 ? Math.round(avg / mid) : avg;
  const edge = Math.round(center * info.edgeRatio);
  return { ppfdAvg: avg, ppfdCenter: center, ppfdEdge: edge, source: "ppf" };
}
