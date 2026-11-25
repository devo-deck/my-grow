import { getCycleProgress, mixProduct, formatMixAmount, mixPlanWeek } from "../data/grow_plan_logic.js";
import {
  currentPhase,
  cycleOverview,
  CYCLE_DAYS,
  nextPhaseEvent,
  countdownParts,
  wateringIntervalDays,
  wateringStatus,
  addWatering,
  estimatePPFD,
  estimatePPFDAt,
  lampPPF,
  snapToDimStep,
  recommendLampSetup,
  tentAreaM2,
  OMEGA_LAMP,
  parseExport,
  exportPayload,
  FLOWER_START_DAY,
  FLUSH_START_DAY,
  HARVEST_DAY,
  flowerStartDay,
  harvestDayOffset,
  flushDayOffset,
  weekDayRanges,
  weekIndexForDay,
  getGrowProgress,
  growWeekDateRange,
  tasksForWeek,
  lampTypeInfo,
  adjustHangRange,
  heightFactor,
  emptyPpfdRef,
  addDaysISO,
} from "../js/app-logic.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function almost(a, b, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

const now = new Date(2026, 10, 25, 12, 0, 0);

// cycle
const p0 = getCycleProgress("2026-11-25", now, 14);
assert(p0.status === "active" && p0.weekIndex === 0 && p0.dayNumber === 1, "start today");
const pVeg = getCycleProgress("2026-11-01", now, 14);
assert(pVeg.status === "active" && pVeg.weekIndex === 3, "Nov 1 -> week index 3, got " + pVeg.weekIndex);

// mix
const row = mixProduct({ name: "Grow A", unit: "ml/L", amountPerL: 2.9 }, 10);
assert(row.total === 29, "2.9 * 10 = 29");
const range = mixProduct({ name: "CaMg", unit: "ml/L", minPerL: 0.8, maxPerL: 1.3 }, 10);
assert(formatMixAmount(range) === "8–13 ml", formatMixAmount(range));

// phases
assert(currentPhase("2026-11-25", now).id === "start", "phase start");
assert(currentPhase("2026-11-18", now).id === "veg", "phase veg day 7");
const bloomDay = new Date(2026, 9, 21, 12); // Oct 21 + 35 days = Nov 25
assert(currentPhase("2026-10-21", now).id === "flower", "phase flower at day 35");
assert(currentPhase("2026-08-22", now).id === "flush" || currentPhase("2026-08-22", now).id === "harvest", "late cycle");

const ev = nextPhaseEvent("2026-11-25", now);
assert(ev && ev.id === "veg" && ev.atDay === 7, "next from start is veg");
const parts = countdownParts(ev.at, now);
assert(!parts.overdue && parts.days === 6, "countdown days " + parts.days);

assert(FLOWER_START_DAY === 35 && FLUSH_START_DAY === 95 && HARVEST_DAY === 98, "boundaries");
assert(CYCLE_DAYS === 98, "cycle days");
const ov = cycleOverview("2026-11-01", now, 14);
assert(ov.status === "active" && ov.totalDays === 98 && ov.totalWeeks === 14, "overview totals");
assert(ov.dayNumber === 25 && ov.remainingDays === 74, "Nov 1 -> day 25, 74 left, got " + ov.dayNumber + " " + ov.remainingDays);
const ov0 = cycleOverview("2026-11-25", now, 14);
assert(ov0.remainingDays === 98 && ov0.dayNumber === 1, "start day remaining");
const ovDone = cycleOverview("2026-08-01", now, 14);
assert(ovDone.status === "done" && ovDone.remainingDays === 0, "done cycle");

// watering
assert(wateringIntervalDays("erde", "veg") === 3, "erde veg interval");
assert(wateringIntervalDays("kokos", "flower") === 1, "coco flower daily");
const dry = wateringStatus([], "2026-11-25", 3);
assert(dry.waterToday === true, "never watered -> today");
const recent = wateringStatus(["2026-11-24"], "2026-11-25", 3);
assert(recent.waterToday === false && recent.nextISO === "2026-11-27", JSON.stringify(recent));
const due = wateringStatus(["2026-11-22"], "2026-11-25", 3);
assert(due.waterToday === true && due.daysSince === 3, JSON.stringify(due));
assert(addWatering(["2026-11-20"], "2026-11-25").join() === "2026-11-20,2026-11-25", "add watering");
assert(addWatering(["2026-11-25"], "2026-11-25").length === 1, "no dup watering");

// lamp / ppfd
assert(tentAreaM2({ widthM: 1.2, lengthM: 1.2 }) === 1.44, "area");
assert(lampPPF(OMEGA_LAMP) === 1890, "omega ppf");
assert(lampPPF({ watts: 600, umolPerJ: 3, ppf: 0 }) === 1800, "ppf from watts*efficacy");
const est = estimatePPFD(1890, 100, 1.44, 0.85);
assert(est === Math.round(1890 * 0.85 / 1.44), "ppfd full " + est);
assert(snapToDimStep(72, [0, 25, 50, 75, 100]) === 75, "snap 72->75");
assert(snapToDimStep(10, [0, 25, 50, 75, 100]) === 25, "snap 10->25 not 0");
const rec = recommendLampSetup(OMEGA_LAMP, 1.44, [400, 600], [60, 70], [0, 25, 50, 75, 100]);
assert(rec.dimPct >= 25 && rec.dimPct <= 100 && rec.ppfdEstimate > 0, "recommend " + JSON.stringify(rec));

// export
const payload = exportPayload([{ id: "g1", name: "Test" }], "g1");
assert(payload.kind === "devrim-grow-app" && payload.grows[0].id === "g1", "export");
const parsed = parseExport(JSON.stringify(payload));
assert(parsed && parsed.activeId === "g1" && parsed.grows.length === 1, "import all");
const single = parseExport(JSON.stringify({ schemaVersion: 1, name: "Papa", startDate: "2026-12-01", plan: { schemaVersion: 1, name: "x", products: [], weekTargets: [] } }));
assert(single && single.grows[0].name === "Papa" && single.grows[0].startDate === "2026-12-01", "import single");
assert(parseExport("not json") === null, "bad json");

// flip calendar
assert(flowerStartDay("2026-11-01", "") === 35, "default flip day");
assert(flowerStartDay("2026-11-01", "2026-12-06") === 35, "planned date is day 35");
assert(flowerStartDay("2026-11-01", "2026-12-20") === 49, "late flip day 49");
assert(flowerStartDay("2026-11-01", "2026-11-22") === 21, "early flip day 21");
assert(flowerStartDay("2026-11-01", "2026-10-01") === 35, "flip before start ignored");
assert(harvestDayOffset("2026-11-01", "2026-12-20") === 49 + 63, "late harvest");
assert(flushDayOffset("2026-11-01", "") === 95, "default flush");

const lateRanges = weekDayRanges(49);
assert(lateRanges[3].endDay === 27 && lateRanges[4].startDay === 28 && lateRanges[4].endDay === 48, "week 4 extends");
assert(lateRanges[5].startDay === 49 && lateRanges[5].endDay === 55, "flower 1 at flip");
assert(weekIndexForDay(40, 49) === 4, "day 40 still veg-4");
assert(weekIndexForDay(49, 49) === 5, "flip day is flower-1");

const earlyRanges = weekDayRanges(21);
assert(earlyRanges[0] && earlyRanges[2] && earlyRanges[3] == null && earlyRanges[4] == null, "early flip skips veg 3-4");
assert(weekIndexForDay(21, 21) === 5, "early flip jumps to flower");

const lateNow = new Date(2026, 10, 25, 12);
const lateProg = getGrowProgress("2026-11-01", lateNow, 14, "2026-12-20");
assert(lateProg.status === "active" && lateProg.weekIndex === 3, "late flip still week 3 on day 24");
const lateOv = cycleOverview("2026-11-01", lateNow, 14, "2026-12-20");
assert(lateOv.totalDays === 112 && lateOv.remainingDays === 88, "cycle stretches, got " + lateOv.totalDays + " " + lateOv.remainingDays);
assert(currentPhase("2026-11-01", lateNow, 14, "2026-12-20").id === "veg", "still veg before late flip");
const lateEv = nextPhaseEvent("2026-11-01", lateNow, 14, "2026-12-20");
assert(lateEv && lateEv.id === "flower" && lateEv.atDay === 49, "next is late bloom");

const earlyFlipISO = "2026-11-15";
assert(flowerStartDay("2026-11-01", earlyFlipISO) === 14, "nov 15 is day 14");
const afterEarly = new Date(2026, 10, 20, 12);
assert(currentPhase("2026-11-01", afterEarly, 14, earlyFlipISO).id === "flower", "early flip already flower");
assert(getGrowProgress("2026-11-01", afterEarly, 14, earlyFlipISO).weekIndex === 5, "feed week flower-1, got " + getGrowProgress("2026-11-01", afterEarly, 14, earlyFlipISO).weekIndex);

const wr = growWeekDateRange("2026-11-01", 4, "2026-12-20");
assert(wr && wr.start === "2026-11-29" && wr.end === "2026-12-19", "extended veg-4 dates " + JSON.stringify(wr));
assert(growWeekDateRange("2026-11-01", 3, earlyFlipISO) == null, "unused veg week has no dates");
assert(addDaysISO("2026-11-01", 35) === "2026-12-06", "add days");

assert(getGrowProgress("2026-11-01", now, 14).weekIndex === 3, "default progress matches");
assert(cycleOverview("2026-11-01", now, 14).remainingDays === 74, "default remaining stays 74");

// substrate-aware tasks
const cocoSoak = { tasks: ["Kokos voreinweichen nach Athena: pH 5,5–5,8, EC 3,5–4,0.", "Netz tief spannen."] };
const erdeTasks = tasksForWeek(cocoSoak, "erde");
assert(erdeTasks[0].includes("Erde") && !erdeTasks[0].includes("Kokos voreinweichen nach"), "erde no coco soak: " + erdeTasks[0]);
assert(erdeTasks[1].includes("Netz"), "other tasks kept");
assert(tasksForWeek(cocoSoak, "kokos")[0].startsWith("Kokos voreinweichen"), "kokos keeps soak");
const flushTask = { tasks: ["Letzte 3 Tage in Kokos: Umkehrosmose- oder sehr weiches Wasser plus Athena Cleanse 2,6 ml/L."] };
assert(!tasksForWeek(flushTask, "erde")[0].startsWith("Letzte 3 Tage in Kokos"), "erde flush wording");
assert(tasksForWeek(flushTask, "kokos")[0].startsWith("Letzte 3 Tage in Kokos"), "kokos flush kept");

// lamp types
assert(OMEGA_LAMP.type === "bar", "omega is Fläche/bar");
assert(lampTypeInfo("bar").hangShiftCm === 0 && lampTypeInfo("panel").hangShiftCm === 10 && lampTypeInfo("spot").hangShiftCm === 25, "hang shifts");
assert(lampTypeInfo("spot").utilization < lampTypeInfo("panel").utilization && lampTypeInfo("panel").utilization < lampTypeInfo("bar").utilization, "util");
assert(lampTypeInfo("spot").edgeRatio < lampTypeInfo("bar").edgeRatio, "spot less uniform");
const hangBar = adjustHangRange([60, 70], "bar");
const hangPanel = adjustHangRange([60, 70], "panel");
const hangSpot = adjustHangRange([60, 70], "spot");
assert(hangBar[0] === 60 && hangPanel[0] === 70 && hangSpot[0] === 85, "hang order " + hangBar + hangPanel + hangSpot);
assert(heightFactor("bar", 65, 65) === 1, "factor 1 at ref");
assert(heightFactor("spot", 80, 40) < heightFactor("bar", 80, 40), "spot falls off faster");

const recBar = recommendLampSetup(OMEGA_LAMP, 1.44, [400, 600], [60, 70], [0, 25, 50, 75, 100], { type: "bar" });
const recSpot = recommendLampSetup(OMEGA_LAMP, 1.44, [400, 600], [60, 70], [0, 25, 50, 75, 100], { type: "spot" });
assert(recBar.dimPct === 50 && recBar.ppfdEstimate === 558, "bar rec unchanged " + JSON.stringify(recBar));
assert(recSpot.hangCm[0] > recBar.hangCm[0], "spot hangs higher");
assert(recSpot.ppfdEdge < recSpot.ppfdCenter, "spot hotspot");
assert(recBar.source === "ppf", "bar source ppf");

// manufacturer interpolate
const mfr = { manufacturer: [{ heightCm: 40, ppfdAvg: 1000, dimPct: 100, areaM2: 1.44 }, { heightCm: 60, ppfdAvg: 800, dimPct: 100, areaM2: 1.44 }], readings: [] };
const midMfr = estimatePPFDAt({ lamp: OMEGA_LAMP, areaM2: 1.44, dimPct: 100, heightCm: 50, type: "bar", ppfdRef: mfr });
assert(midMfr.source === "manufacturer" && midMfr.ppfdAvg === 900, "lerp 40/60 -> 900 at 50, got " + JSON.stringify(midMfr));
const halfMfr = estimatePPFDAt({ lamp: OMEGA_LAMP, areaM2: 1.44, dimPct: 50, heightCm: 50, type: "bar", ppfdRef: mfr });
assert(halfMfr.ppfdAvg === 450, "dim scales manufacturer " + halfMfr.ppfdAvg);

// readings beat manufacturer and ppf
const mixed = {
  manufacturer: [{ heightCm: 50, ppfdAvg: 999, dimPct: 100 }],
  readings: [{ heightCm: 50, dimPct: 100, ppfdCenter: 700, ppfdEdge: 500 }],
};
const fromRead = estimatePPFDAt({ lamp: OMEGA_LAMP, areaM2: 1.44, dimPct: 100, heightCm: 50, type: "bar", ppfdRef: mixed });
assert(fromRead.source === "reading" && fromRead.ppfdAvg === 600 && fromRead.ppfdCenter === 700 && fromRead.ppfdEdge === 500, "readings win " + JSON.stringify(fromRead));

const recMfr = recommendLampSetup(OMEGA_LAMP, 1.44, [400, 600], [60, 70], [0, 25, 50, 75, 100], { type: "bar", ppfdRef: mfr });
assert(recMfr.source === "manufacturer" && recMfr.dimPct > 0, "recommend uses mfr " + JSON.stringify(recMfr));

const one = { manufacturer: [{ heightCm: 60, ppfdAvg: 800, dimPct: 100, areaM2: 1.44 }], readings: [] };
const at60 = estimatePPFDAt({ lamp: OMEGA_LAMP, areaM2: 1.44, dimPct: 75, heightCm: 60, type: "bar", ppfdRef: one });
assert(at60.ppfdAvg === 600, "single point * 0.75 = 600, got " + at60.ppfdAvg);

assert(emptyPpfdRef().manufacturer.length === 0, "empty ref");

console.log("All logic tests passed.");
