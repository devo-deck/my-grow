import {
  daysSinceStart,
  formatMixAmount,
  formatNumber,
  mixPlanWeek,
  mixRecipe,
  toISODate,
} from "../data/grow_plan_logic.js";
import {
  OMEGA_LAMP,
  LAMP_TYPE_LIST,
  addDaysISO,
  addWatering,
  currentPhase,
  countdownParts,
  defaultGrow,
  exportPayload,
  flowerStartDay,
  getGrowProgress,
  growWeekDateRange,
  harvestDayOffset,
  lampPPF,
  lampTypeInfo,
  nextPhaseEvent,
  cycleOverview,
  normalizePpfdRef,
  parseExport,
  recommendLampSetup,
  resolveLamp,
  tasksForWeek,
  tentAreaM2,
  wateringIntervalDays,
  wateringStatus,
} from "./app-logic.js";
import { activeGrow, deleteGrow, emptyState, loadState, saveState, upsertGrow } from "./storage.js";

const WEEK_COUNT = 14;
const $app = document.getElementById("app");

let DATA = null;
let state = emptyState();
let route = "heute";
let planIndex = 0;
let wizard = null;
let fertProductId = "";
let importText = "";
let notice = "";
let now = new Date();
let deferredInstall = null;
let saveTimer = 0;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nfmt(n) {
  return formatNumber(Number(n));
}

function rangeFmt(values, suffix) {
  if (!values || !values.length) return "—";
  const a = values[0];
  const b = values[values.length - 1];
  if (values.length === 1 || a === b) return `${nfmt(a)} ${suffix}`.trim();
  return `${nfmt(a)}–${nfmt(b)} ${suffix}`.trim();
}

function deDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!d) return iso;
  return `${Number(d)}.${Number(m)}.${y}`;
}

function todayISO() {
  return toISODate(now);
}

function icon(name) {
  const icons = {
    heute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    duenger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6l1 5H8L9 3Z"/><path d="M8 8c0 7 4 13 4 13s4-6 4-13"/></svg>',
    lampe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 8h14M7 8c0 4 2.2 6 5 7v4M17 8c0 4-2.2 6-5 7M9 21h6"/></svg>',
    mehr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 5 8 12l7 7"/></svg>',
  };
  return icons[name] || "";
}

function buildAthenaPlan() {
  const weeks = DATA.weeks;
  const preset = DATA.feedPresets["athena-blended-metric-a01-004"];
  const defs = preset.products;
  const products = defs.map((def) => ({
    id: def.id,
    name: def.name,
    unit: def.unit || "ml/L",
    doses: weeks.map((week) => {
      const recipe = preset.weeks[week.feedKey] || {};
      const dose = recipe.dosesMlPerL ? recipe.dosesMlPerL[def.id] : undefined;
      return dose == null ? null : dose;
    }),
    ranges: weeks.map((week) => {
      const recipe = preset.weeks[week.feedKey] || {};
      const range = recipe.rangesMlPerL ? recipe.rangesMlPerL[def.id] : undefined;
      return range ? [range[0], range[1]] : null;
    }),
  }));
  return {
    schemaVersion: 1,
    name: preset.name,
    presetId: preset.id,
    products,
    weekTargets: weeks.map((week) => {
      const recipe = preset.weeks[week.feedKey] || {};
      return { ec: recipe.ec ?? null, pH: pHForSubstrate(recipe.pH) };
    }),
  };
}

function pHForSubstrate(official, substrate) {
  const sub = substrate || (activeGrow(state) && activeGrow(state).substrate) || "erde";
  if (typeof official === "string" && official.includes("5.6")) return "5,6";
  if (sub === "kokos") return "5,8–6,2";
  if (official && String(official).includes("6.0–6.4 (alle")) return "6,0–6,4";
  return sub === "erde" ? "6,0–6,4" : official || "";
}

function growPlan(grow) {
  return grow && grow.plan && grow.plan.products ? grow.plan : buildAthenaPlan();
}

function weeks() {
  return DATA.weeks;
}

function currentGrow() {
  return activeGrow(state);
}

function progressFor(grow) {
  if (!grow || !grow.startDate) return getGrowProgress("", now, WEEK_COUNT);
  return getGrowProgress(grow.startDate, now, WEEK_COUNT, grow.flipDate);
}

function lampRec(grow, targetPpfd, hangCm) {
  const lamp = resolveLamp(grow);
  const area = tentAreaM2(grow.tent);
  return recommendLampSetup(lamp, area, targetPpfd, hangCm, lamp.dimSteps, {
    type: grow.lampType || lamp.type || "bar",
    ppfdRef: grow.ppfdRef,
    tentHeightM: grow.tent && grow.tent.heightM,
  });
}

function ppfdSourceNote(source, typeId) {
  const typ = lampTypeInfo(typeId).short;
  if (source === "reading") return "Aus deinen Messungen interpoliert, keine Lichtkarte.";
  if (source === "manufacturer") return "Aus Hersteller-PPFD interpoliert, keine Lichtkarte.";
  return `Schätzung für Typ ${typ} (PPF × Dimmung ÷ Fläche, Abstand und Streuung). Keine Messung.`;
}

function setRoute(name, opts) {
  route = name;
  if (name === "plan") {
    if (opts && opts.week != null) planIndex = opts.week;
    else if (currentGrow()) planIndex = progressFor(currentGrow()).weekIndex;
  }
  if (name === "wizard" && !wizard) startWizard();
  location.hash = name === "heute" ? "#/heute" : `#/${name}`;
  render();
  if (name === "plan") queueMicrotask(scrollPlanToIndex);
}

function parseHash() {
  const h = (location.hash || "#/heute").replace(/^#\/?/, "");
  const name = h.split("/")[0] || "heute";
  return name;
}

async function persist() {
  const ok = await saveState(state);
  return ok;
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { persist(); }, 200);
}

function patchGrow(mutator) {
  const grow = currentGrow();
  if (!grow) return;
  const next = { ...grow, plan: grow.plan ? JSON.parse(JSON.stringify(grow.plan)) : grow.plan };
  mutator(next);
  state = upsertGrow(state, next);
  queueSave();
  render();
}

function startWizard() {
  const g = currentGrow();
  wizard = {
    step: 0,
    draft: {
      name: "Mein Grow",
      startDate: todayISO(),
      plants: 3,
      tentWcm: 120,
      tentLcm: 120,
      tentHcm: 200,
      substrate: "erde",
      substrateCustom: "",
      potL: 25,
      tankL: 10,
      lampId: OMEGA_LAMP.id,
    },
  };
}

function finishWizard() {
  const d = wizard.draft;
  const grow = defaultGrow({
    name: d.name.trim() || "Mein Grow",
    startDate: d.startDate || todayISO(),
    plants: Number(d.plants) || 3,
    tent: { widthM: Number(d.tentWcm) / 100, lengthM: Number(d.tentLcm) / 100, heightM: Number(d.tentHcm) / 100 },
    substrate: d.substrate,
    substrateCustom: d.substrateCustom,
    potL: Number(d.potL) || 25,
    tankL: Number(d.tankL) || 10,
    lampId: d.lampId || OMEGA_LAMP.id,
    plan: buildAthenaPlan(),
  });
  state = upsertGrow(state, grow);
  wizard = null;
  notice = "Grow gestartet.";
  persist();
  setRoute("heute");
}

function pill(text, kind) {
  return `<span class="pill ${kind || ""}">${esc(text)}</span>`;
}

function topBar(title, sub, backTo) {
  return `<div class="top">
    <div>
      ${backTo ? `<button class="icon-btn" data-go="${backTo}" aria-label="Zurück">${icon("back")}</button>` : ""}
      <h1>${esc(title)}</h1>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
    </div>
  </div>`;
}

function nav(active) {
  const items = [
    ["heute", "Heute"],
    ["plan", "Plan"],
    ["duenger", "Dünger"],
    ["lampe", "Lampe"],
    ["mehr", "Mehr"],
  ];
  return `<nav class="nav">${items.map(([id, label]) =>
    `<button data-go="${id}" class="${id === active ? "on" : ""}">${icon(id)}<span>${label}</span></button>`
  ).join("")}</nav>`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function renderHeute() {
  const grow = currentGrow();
  if (!grow) {
    return `${topBar("My Grow", "Noch kein Durchgang")}
      <div class="empty card">
        <div class="num">+</div>
        <p class="muted mt-8">Lege einen Grow an. Dann siehst du Dauer, Restzeit und den Düngerplan.</p>
        <button class="btn primary mt-16" data-go="wizard">Grow anlegen</button>
      </div>` + nav("heute");
  }
  const prog = progressFor(grow);
  const week = weeks()[prog.weekIndex] || weeks()[0];
  const phase = currentPhase(grow.startDate, now, WEEK_COUNT, grow.flipDate);
  const ev = nextPhaseEvent(grow.startDate, now, WEEK_COUNT, grow.flipDate);
  const cd = ev ? countdownParts(ev.at, now) : null;
  const lamp = resolveLamp(grow);
  const rec = lampRec(grow, week.ppfd, week.hangCm);
  const dimUsed = rec.dimPct;
  const ppfdEst = rec.ppfdEstimate;
  const target = rangeFmt(week.ppfd, "");
  const plan = growPlan(grow);
  const mix = mixPlanWeek(plan, prog.weekIndex, Number(grow.tankL) || 10);
  const interval = wateringIntervalDays(grow.substrate, phase.id);
  const water = wateringStatus(grow.waterings, todayISO(), interval);
  const cycle = cycleOverview(grow.startDate, now, WEEK_COUNT, grow.flipDate);
  const harvestCd = cycle.harvestAt ? countdownParts(cycle.harvestAt, now) : null;
  const inTarget = ppfdEst != null && week.ppfd && ppfdEst >= week.ppfd[0] && ppfdEst <= week.ppfd[week.ppfd.length - 1];
  let remainHtml;
  if (cycle.status === "no-date") {
    remainHtml = `<div class="label mt-12">Gesamtdauer</div>
      <div class="num num-xl mt-8">${cycle.totalWeeks}</div>
      <div class="sub">Wochen · ${cycle.totalDays} Tage</div>
      <p class="next-line">Zuerst ein Startdatum setzen.</p>`;
  } else if (cycle.status === "upcoming") {
    remainHtml = `<div class="label mt-12">Start in</div>
      <div class="num num-xl mt-8">${cycle.startsIn}</div>
      <div class="sub">Tagen · danach ${cycle.totalWeeks} Wochen / ${cycle.totalDays} Tage</div>`;
  } else if (cycle.status === "done" || (harvestCd && harvestCd.overdue)) {
    remainHtml = `<div class="label mt-12">Gesamtdauer</div>
      <div class="num num-xl mt-8">0</div>
      <div class="sub">Tage übrig · ${cycle.totalWeeks} Wochen sind rum</div>
      <div class="progress"><span style="width:100%"></span></div>`;
  } else {
    remainHtml = `<div class="label mt-12">Noch</div>
      <div class="num num-xl mt-8">${harvestCd ? harvestCd.days : cycle.remainingDays}</div>
      <div class="sub">Tage bis zur Ernte · Tag ${cycle.dayNumber} von ${cycle.totalDays} · ${cycle.totalWeeks} Wochen</div>
      <div class="progress"><span style="width:${cycle.pct}%"></span></div>
      <div class="countdown">
        <div class="cd-cell"><div class="num">${harvestCd.days}</div><span class="label">Tage</span></div>
        <div class="cd-cell"><div class="num">${pad2(harvestCd.hours)}</div><span class="label">Std</span></div>
        <div class="cd-cell"><div class="num">${pad2(harvestCd.minutes)}</div><span class="label">Min</span></div>
        <div class="cd-cell"><div class="num">${pad2(harvestCd.seconds)}</div><span class="label">Sek</span></div>
      </div>`;
  }
  let nextLine = "";
  if (ev && cd && !cd.overdue && ev.id !== "harvest") {
    nextLine = `<p class="next-line">Nächster Abschnitt: ${esc(ev.label)} in ${cd.days}T ${pad2(cd.hours)}:${pad2(cd.minutes)}</p>`;
  } else if (phase.id === "harvest" || cycle.status === "done") {
    nextLine = `<p class="next-line">Zyklus zu Ende.</p>`;
  }
  const feedLines = mix.length
    ? mix.map((row) => `<div class="feed-line"><span>${esc(row.name)}</span><span class="amt">${esc(formatMixAmount(row))}</span></div>`).join("")
    : `<p class="muted">Keine Dosis in dieser Woche.</p>`;
  const perL = mix.map((row) => {
    if (row.minPerL != null && row.maxPerL != null) return `${row.name} ${nfmt(row.minPerL)}–${nfmt(row.maxPerL)} ${row.unit}/L`;
    return `${row.name} ${nfmt(row.amountPerL)} ${row.unit}/L`;
  }).join(" · ");

  return `${topBar("My Grow", esc(grow.name))}
    <div class="grid">
      <div class="card pad-lg hero-remain">
        <div class="row">
          <div class="label">${esc(week.label)}</div>
          ${pill(phase.label, phase.id === "flush" || phase.id === "harvest" ? "warn" : "ok")}
        </div>
        ${remainHtml}
        ${nextLine}
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="label">Lampe</div>
          <div class="num num-lg mt-8">${nfmt(dimUsed)}<span class="unit"> %</span></div>
          <div class="sub mt-8">${rangeFmt(rec.hangCm || week.hangCm, "cm")}</div>
        </div>
        <div class="card">
          <div class="label">PPFD</div>
          <div class="num num-lg mt-8">${ppfdEst == null ? "—" : nfmt(ppfdEst)}</div>
          <div class="sub mt-8">Ziel ${esc(target)} ${inTarget ? "ok" : ""}</div>
        </div>
      </div>
      ${grow.startDate ? `<div class="card">
        <div class="label">Umstellung 12/12</div>
        <div class="field mt-12">
          <input type="date" data-field="flip-date" value="${esc(grow.flipDate || "")}">
        </div>
        <p class="sub mt-8">${grow.flipDate
          ? `Blüte ab ${deDate(grow.flipDate)} · Ernte ${deDate(addDaysISO(grow.startDate, harvestDayOffset(grow.startDate, grow.flipDate)))}`
          : `Geplant ${deDate(addDaysISO(grow.startDate, flowerStartDay(grow.startDate, "")))} · ändern, wenn du früher oder später umstellst.`}</p>
      </div>` : ""}
      <div class="card">
        <div class="row">
          <div class="label">Dünger · ${nfmt(grow.tankL)} L</div>
          <button class="pill" data-go="duenger">Plan</button>
        </div>
        <p class="sub mt-8">${perL ? esc(perL) : "—"}</p>
        <div class="mt-8">${feedLines}</div>
      </div>
      <div class="card">
        <div class="row">
          <div class="label">Gießen</div>
          ${water.waterToday ? pill("Heute ja", "warn") : pill("Nicht nötig", "ok")}
        </div>
        <div class="num num-md mt-8">${water.waterToday ? "Jetzt" : "Später"}</div>
        <p class="sub mt-8">Nächste: ${esc(deDate(water.nextISO))}${water.lastISO ? ` · zuletzt ${deDate(water.lastISO)}` : ""}</p>
        <button class="btn primary mt-16" data-action="water" ${!water.waterToday && water.lastISO === todayISO() ? "disabled" : ""}>${water.lastISO === todayISO() ? "Heute gegossen" : "Gegossen"}</button>
      </div>
      ${Number(grow.plants) > 3 ? `<div class="warn-note">Gesetzlich höchstens 3 Pflanzen pro erwachsener Person.</div>` : ""}
    </div>` + nav("heute");
}

function renderPlan() {
  const grow = currentGrow();
  if (!grow) return emptyNav("plan");
  const prog = progressFor(grow);
  const plan = growPlan(grow);
  const slides = weeks().map((week, i) => {
    const current = prog.status === "active" && prog.weekIndex === i;
    const target = plan.weekTargets[i] || {};
    const mix = mixPlanWeek(plan, i, 1);
    const doses = mix.map((row) => {
      if (row.minPerL != null) return `${row.name} ${nfmt(row.minPerL)}–${nfmt(row.maxPerL)}`;
      return `${row.name} ${nfmt(row.amountPerL)}`;
    }).join(" · ") || "—";
    const range = grow.startDate ? growWeekDateRange(grow.startDate, i, grow.flipDate) : null;
    const rec = lampRec(grow, week.ppfd, week.hangCm);
    const unused = grow.startDate && !range;
    const tasks = tasksForWeek(week, grow.substrate);
    return `<article class="week-slide card" data-week="${i}">
      <div class="row">
        <div class="label">${esc(week.shortLabel)}</div>
        ${current ? pill("Diese Woche", "ok") : unused ? pill("Übersprungen", "warn") : ""}
      </div>
      <div class="num num-md mt-8">${esc(week.label)}</div>
      <div class="sub">${range ? `${deDate(range.start)}–${deDate(range.end)}` : unused ? "Kein Datum · früher 12/12" : week.photoperiod}</div>
      <div class="grid-2 mt-16">
        <div>
          <div class="label">Licht</div>
          <p class="mt-8">${unused ? "—" : `${esc(week.photoperiod)} · ${esc(nfmt(rec.dimPct))} %`}<br>${unused ? "" : esc(rangeFmt(rec.hangCm, "cm"))}</p>
        </div>
        <div>
          <div class="label">PPFD / EC</div>
          <p class="mt-8">${esc(rangeFmt(week.ppfd, ""))}${rec.ppfdEstimate != null ? ` · ≈ ${nfmt(rec.ppfdEstimate)}` : ""}<br>EC ${target.ec == null ? "—" : nfmt(target.ec)} · pH ${esc(target.pH || "—")}</p>
        </div>
      </div>
      <div class="label mt-16">Dünger je L</div>
      <p class="mt-8">${esc(doses)}</p>
      <div class="label mt-16">Gießen</div>
      <p class="mt-8">${esc(week.watering.frequency)} · ${esc(rangeFmt(week.watering.volumeLPerPot, "L"))}</p>
      <div class="label mt-16">Tun</div>
      <p class="mt-8 info-block">${tasks.map((task) => esc(task)).join("<br>")}</p>
    </article>`;
  }).join("");
  const dots = weeks().map((_, i) => `<i class="${i === planIndex ? "on" : ""}"></i>`).join("");
  return `${topBar("Plan", "14 Wochen")}
    <div class="btn-row">
      <button class="btn" data-action="plan-prev">Zurück</button>
      <button class="btn" data-action="plan-next">Weiter</button>
    </div>
    <div class="dots">${dots}</div>
    <div class="week-track" id="week-track">${slides}</div>` + nav("plan");
}

function emptyNav(active) {
  return `${topBar("Grow", "Zuerst anlegen")}
    <div class="empty card">
      <p class="muted">Noch kein Grow.</p>
      <button class="btn primary mt-16" data-go="wizard">Grow anlegen</button>
    </div>` + nav(active);
}

function doseCell(product, i) {
  const range = product.ranges && product.ranges[i];
  if (range) return `${nfmt(range[0])}–${nfmt(range[1])}`;
  const dose = product.doses ? product.doses[i] : null;
  if (dose == null) return "—";
  return nfmt(dose);
}

function renderSchemaTable(plan, currentIndex) {
  const head = weeks().map((w, i) => `<th class="${i === currentIndex ? "on" : ""}">${esc(w.shortLabel)}</th>`).join("");
  const body = plan.products.map((p) => {
    const cells = weeks().map((_, i) => `<td class="${i === currentIndex ? "on" : ""}">${doseCell(p, i)}</td>`).join("");
    return `<tr><th>${esc(p.name)}<span class="unit-mini">${esc(p.unit)}</span></th>${cells}</tr>`;
  }).join("");
  const ec = weeks().map((_, i) => {
    const target = plan.weekTargets[i] || {};
    return `<td class="${i === currentIndex ? "on" : ""}">${target.ec == null ? "—" : nfmt(target.ec)}</td>`;
  }).join("");
  const ph = weeks().map((_, i) => {
    const target = plan.weekTargets[i] || {};
    return `<td class="${i === currentIndex ? "on" : ""}">${esc(target.pH || "—")}</td>`;
  }).join("");
  return `<div class="schema-wrap"><table class="schema">
    <thead><tr><th>Woche</th>${head}</tr></thead>
    <tbody>
      ${body}
      <tr class="meta"><th>EC</th>${ec}</tr>
      <tr class="meta"><th>pH</th>${ph}</tr>
    </tbody>
  </table></div>`;
}

function renderDuenger() {
  const grow = currentGrow();
  if (!grow) return emptyNav("duenger");
  const prog = progressFor(grow);
  const plan = growPlan(grow);
  if (!fertProductId && plan.products[0]) fertProductId = plan.products[0].id;
  const week = weeks()[prog.weekIndex];
  const mix = mixPlanWeek(plan, prog.weekIndex, Number(grow.tankL) || 10);
  const selected = plan.products.find((p) => p.id === fertProductId) || plan.products[0];
  const idx = prog.status === "past" || prog.status === "active" ? prog.weekIndex : planIndex;
  const editorIdx = route === "duenger" ? idx : idx;
  const editWeek = weeks()[editorIdx];
  const target = plan.weekTargets[editorIdx] || { ec: null, pH: "" };
  const options = plan.products.map((p) => `<option value="${esc(p.id)}" ${selected && p.id === selected.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const doseVal = selected && selected.doses[editorIdx] != null ? String(selected.doses[editorIdx]).replace(".", ",") : "";
  const mixHtml = mix.length
    ? mix.map((row) => `<div class="feed-line"><span>${esc(row.name)}</span><span class="amt">${esc(formatMixAmount(row))}</span></div>`).join("")
    : `<p class="muted">Keine Dosis.</p>`;
  const weekOpts = weeks().map((w, i) => `<option value="${i}" ${i === editorIdx ? "selected" : ""}>${esc(w.label)}</option>`).join("");
  return `${topBar("Dünger", esc(plan.name))}
    <div class="grid">
      <div class="card schema-card">
        <div class="label">Düngeschema</div>
        <div class="sub mt-8">Alle Wochen, je Liter. Aktuelle Woche ist markiert.</div>
        ${renderSchemaTable(plan, prog.weekIndex)}
      </div>
      <div class="card">
        <div class="label">Heute · ${esc(week.label)} · ${nfmt(grow.tankL)} L</div>
        <div class="field mt-12">
          <label class="label">Tank (L)</label>
          <input type="number" inputmode="decimal" data-field="tankL" value="${esc(grow.tankL)}">
        </div>
        <div class="mt-8">${mixHtml}</div>
      </div>
      <div class="card">
        <div class="label">Anpassen</div>
        <div class="field mt-12">
          <label class="label">Woche</label>
          <select data-action="fert-week">${weekOpts}</select>
        </div>
        <div class="field mt-12">
          <label class="label">Produkt</label>
          <select data-action="fert-product">${options || "<option>Kein Produkt</option>"}</select>
        </div>
        ${selected ? `
        <div class="field mt-12">
          <label class="label">Name</label>
          <input data-field="prod-name" value="${esc(selected.name)}">
        </div>
        <div class="field mt-12">
          <label class="label">Einheit</label>
          <select data-field="prod-unit">
            <option value="ml/L" ${selected.unit === "ml/L" ? "selected" : ""}>ml/L</option>
            <option value="g/L" ${selected.unit === "g/L" ? "selected" : ""}>g/L</option>
          </select>
        </div>
        <div class="field mt-12">
          <label class="label">Dosis in ${esc(editWeek.shortLabel)}</label>
          <input inputmode="decimal" data-field="prod-dose" value="${esc(doseVal)}" placeholder="${selected.ranges[editorIdx] ? rangeFmt(selected.ranges[editorIdx], selected.unit) : "0"}">
        </div>` : ""}
        <div class="btn-row mt-16">
          <button class="btn" data-action="fert-add">+ Produkt</button>
          <button class="btn" data-action="fert-del" ${!selected ? "disabled" : ""}>Entfernen</button>
        </div>
        <div class="grid-2 mt-16">
          <div class="field">
            <label class="label">Ziel-EC</label>
            <input inputmode="decimal" data-field="target-ec" value="${target.ec == null ? "" : String(target.ec).replace(".", ",")}">
          </div>
          <div class="field">
            <label class="label">Ziel-pH</label>
            <input data-field="target-ph" value="${esc(target.pH || "")}">
          </div>
        </div>
        <button class="btn ghost mt-16" data-action="fert-reset">Athena zurücksetzen</button>
      </div>
    </div>` + nav("duenger");
}

function phaseTargets(phaseId) {
  if (phaseId === "start") return DATA.ppfdTargets.clone;
  if (phaseId === "veg") return DATA.ppfdTargets.veg;
  return DATA.ppfdTargets.flowerEstablished;
}

function valOr(v) {
  return v == null || v === "" ? "" : v;
}

function renderPpfdRows(kind, rows, fields) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return `<p class="sub mt-8">Keine Werte. Optional, verbessert die Empfehlung.</p>`;
  return list.map((row, i) => {
    const inputs = fields.map((f) => `<div class="field"><label class="label">${esc(f.label)}</label><input inputmode="decimal" data-field="ppfd-${kind}-${f.key}" data-index="${i}" value="${esc(valOr(row[f.key]))}"></div>`).join("");
    return `<div class="metric-row">
      <div class="metric-fields">${inputs}</div>
      <button class="icon-del" data-action="ppfd-del" data-kind="${kind}" data-index="${i}" aria-label="Zeile löschen">×</button>
    </div>`;
  }).join("");
}

function renderLampe() {
  const grow = currentGrow();
  if (!grow) return emptyNav("lampe");
  const lamp = resolveLamp(grow);
  const typeId = grow.lampType || lamp.type || "bar";
  const typeInfo = lampTypeInfo(typeId);
  const ref = normalizePpfdRef(grow.ppfdRef);
  const c = grow.customLamp || { name: "Eigene Lampe", watts: "", ppf: "", umolPerJ: "", widthM: "", lengthM: "", dimSteps: [0, 25, 50, 75, 100] };
  const phases = [
    { id: "start", label: "Start", hang: (lamp.hangCm && lamp.hangCm.start) || [60, 70], target: DATA.ppfdTargets.clone },
    { id: "veg", label: "Wachstum", hang: (lamp.hangCm && lamp.hangCm.veg) || [60, 70], target: DATA.ppfdTargets.veg },
    { id: "flower", label: "Blüte", hang: (lamp.hangCm && lamp.hangCm.flower) || [40, 50], target: DATA.ppfdTargets.flowerEstablished },
  ];
  const recs = phases.map((p) => ({ p, rec: lampRec(grow, p.target, p.hang) }));
  const recCards = recs.map(({ p, rec }) => {
    const edge = rec.ppfdCenter != null && rec.ppfdEdge != null && rec.ppfdCenter !== rec.ppfdEdge
      ? ` · Mitte ${nfmt(rec.ppfdCenter)} / Rand ${nfmt(rec.ppfdEdge)}`
      : "";
    return `<div class="card">
      <div class="label">${esc(p.label)}</div>
      <div class="num num-md mt-8">${nfmt(rec.dimPct)}<span class="unit"> %</span></div>
      <div class="sub mt-8">${rangeFmt(rec.hangCm, "cm")}</div>
      <div class="sub">PPFD ≈ ${rec.ppfdEstimate == null ? "—" : nfmt(rec.ppfdEstimate)} · Ziel ${rangeFmt(p.target, "")}${edge}</div>
    </div>`;
  }).join("");
  const source = recs[0] ? recs[0].rec.source : "ppf";
  const typeTiles = LAMP_TYPE_LIST.map((ty) => `<button class="tile ${typeId === ty.id ? "on" : ""}" data-action="lamp-type" data-value="${ty.id}"><span>${esc(ty.short)}</span><span class="tile-sub">${ty.id === "bar" ? "Leisten" : ty.id === "spot" ? "COB" : "Quadratisch"}</span></button>`).join("");
  const mfrFields = [
    { key: "heightCm", label: "Höhe cm" },
    { key: "ppfdAvg", label: "PPFD Ø" },
    { key: "dimPct", label: "Dim %" },
    { key: "areaM2", label: "Fläche m²" },
  ];
  const readFields = [
    { key: "heightCm", label: "Höhe cm" },
    { key: "dimPct", label: "Dim %" },
    { key: "ppfdCenter", label: "Mitte" },
    { key: "ppfdEdge", label: "Rand" },
  ];
  const steps = (c.dimSteps || []).join(", ");
  return `${topBar("Lampe", esc(lamp.name))}
    <div class="grid">
      <div class="card">
        <div class="label">Modell</div>
        <div class="tiles mt-12" style="grid-template-columns:1fr 1fr">
          <button class="tile ${grow.lampId !== "custom" ? "on" : ""}" data-action="lamp-preset">Omega 600 Pro 3.0</button>
          <button class="tile ${grow.lampId === "custom" ? "on" : ""}" data-action="lamp-custom">Eigene</button>
        </div>
        <p class="sub mt-12">${nfmt(lamp.watts)} W · PPF ${lampPPF(lamp) ? nfmt(lampPPF(lamp)) : "—"} µmol/s · ${esc((lamp.dimSteps || []).join("/"))} %</p>
      </div>
      <div class="card">
        <div class="label">Typ</div>
        <div class="tiles mt-12">${typeTiles}</div>
        <p class="sub mt-12">${esc(typeInfo.blurb)}</p>
      </div>
      ${recCards}
      <p class="info-block">${esc(ppfdSourceNote(source, typeId))}</p>
      <div class="card" id="ppfd-inputs">
        <div class="label">Hersteller-PPFD</div>
        <p class="sub mt-8">Optional. Ø-PPFD bei Höhe und Fläche, oder mehrere Höhe→PPFD-Paare. Dim leer = 100 %.</p>
        ${renderPpfdRows("mfr", ref.manufacturer, mfrFields)}
        <button class="btn ghost mt-12" data-action="ppfd-add" data-kind="mfr">Wert hinzufügen</button>
      </div>
      <div class="card">
        <div class="label">Eigene Messung</div>
        <p class="sub mt-8">Optional. PAR-Meter: Höhe, Dimmung, PPFD Mitte und Rand. Geht vor Herstellerwerten.</p>
        ${renderPpfdRows("read", ref.readings, readFields)}
        <button class="btn ghost mt-12" data-action="ppfd-add" data-kind="read">Messung hinzufügen</button>
      </div>
      <div class="card">
        <div class="label">Eigene Lampe</div>
        <div class="field mt-12"><label class="label">Name</label><input data-field="cl-name" value="${esc(c.name || "")}"></div>
        <div class="grid-2 mt-12">
          <div class="field"><label class="label">Watt</label><input inputmode="decimal" data-field="cl-watts" value="${esc(c.watts ?? "")}"></div>
          <div class="field"><label class="label">µmol/J</label><input inputmode="decimal" data-field="cl-eff" value="${esc(c.umolPerJ ?? "")}"></div>
        </div>
        <div class="field mt-12"><label class="label">PPF µmol/s (sonst Watt × µmol/J)</label><input inputmode="decimal" data-field="cl-ppf" value="${esc(c.ppf ?? "")}"></div>
        <div class="grid-2 mt-12">
          <div class="field"><label class="label">Breite cm</label><input inputmode="decimal" data-field="cl-w" value="${c.widthM ? nfmt(Number(c.widthM) * 100) : ""}"></div>
          <div class="field"><label class="label">Länge cm</label><input inputmode="decimal" data-field="cl-l" value="${c.lengthM ? nfmt(Number(c.lengthM) * 100) : ""}"></div>
        </div>
        <div class="field mt-12"><label class="label">Dimmerstufen</label><input data-field="cl-steps" value="${esc(steps)}" placeholder="0, 25, 50, 75, 100"></div>
        <button class="btn primary mt-16" data-action="lamp-save-custom">Eigene übernehmen</button>
      </div>
    </div>` + nav("lampe");
}

function renderMehr() {
  const grow = currentGrow();
  const installBtn = deferredInstall ? `<button class="btn primary" data-action="install">Zum Startbildschirm</button>` : "";
  return `${topBar("My Grow", grow ? esc(grow.name) : "")}
    <div class="card">
      <button class="list-item" data-go="grows"><div><div class="name">Grows</div><div class="sub">${state.grows.length} gespeichert</div></div><span class="muted">›</span></button>
      <button class="list-item" data-go="wizard"><div><div class="name">Neuer Grow</div><div class="sub">Name, Start, Zelt, Erde</div></div><span class="muted">›</span></button>
      <button class="list-item" data-go="export"><div><div class="name">Export / Import</div><div class="sub">JSON-Text, bleibt lokal</div></div><span class="muted">›</span></button>
      <button class="list-item" data-go="info"><div><div class="name">Stecklinge & Recht</div><div class="sub">Anbauvereinigungen, Hamburg</div></div><span class="muted">›</span></button>
    </div>
    <div class="card mt-16">
      <div class="label">App</div>
      <p class="info-block mt-12">Funktioniert offline, sobald sie einmal geladen wurde. Zum Installieren auf dem Xiaomi: Chrome-Menü → Zum Startbildschirm hinzufügen. Alles bleibt auf dem Gerät.</p>
      ${installBtn ? `<div class="mt-16">${installBtn}</div>` : ""}
    </div>` + nav("mehr");
}

function renderGrows() {
  const items = state.grows.length
    ? state.grows.map((g) => {
      const on = g.id === (state.activeId || (currentGrow() && currentGrow().id));
      return `<div class="list-item">
        <button data-action="select-grow" data-id="${esc(g.id)}" style="flex:1;text-align:left">
          <div class="name">${esc(g.name)} ${on ? "· aktiv" : ""}</div>
          <div class="sub">${g.startDate ? deDate(g.startDate) : "Kein Start"} · ${nfmt(g.plants)} Pfl. · ${esc(g.substrate)}</div>
        </button>
        <button class="icon-btn" data-action="del-grow" data-id="${esc(g.id)}" aria-label="Löschen">×</button>
      </div>`;
    }).join("")
    : `<p class="muted">Noch keine Grows.</p>`;
  return `${topBar("Grows", "Lokal gespeichert", "mehr")}
    <div class="card">${items}</div>
    <button class="btn primary mt-16" data-go="wizard">Neuer Grow</button>`;
}

function renderInfo() {
  return `${topBar("Stecklinge & Recht", "Kurz und aktuell", "mehr")}
    <div class="grid">
      <div class="warn-note">Höchstens 3 Pflanzen gleichzeitig pro erwachsener Person (KCanG § 9). Stecklinge dürfen nicht versandt werden (§ 20 Abs. 5). Keine Rechtsberatung.</div>
      <div class="card">
        <div class="label">Legal</div>
        <p class="info-block mt-12"><strong>Anbauvereinigungen</strong> dürfen Stecklinge nur persönlich übergeben, mit Ausweis, höchstens fünf pro Person und Monat. In Hamburg steht eine behördliche Liste der erlaubten Vereine. Vorher fragen, ob sie auch an Nichtmitglieder abgeben.</p>
      </div>
      <div class="card">
        <div class="label">Lucky Hemp</div>
        <p class="info-block mt-12">Trustpilot 4,4/5 bei 758 Bewertungen (25.11.2026) gilt für den ganzen Shop. Stecklinge ab 9,97 €, oft als klein kritisiert. Versand bietet der Shop an – gesetzlich ist Stecklingsversand verboten. Deshalb nicht empfehlen.</p>
      </div>
      <div class="card">
        <div class="label">Sensi Seeds</div>
        <p class="info-block mt-12">16,50–25 €, Pflanzenpass, Versand nur DE laut Shop. Trustpilot 1,7/5 bei 1.647 Bewertungen aus öffentlichen Treffern; die Live-Seite war nicht zuverlässig erreichbar. Ebenfalls kein legaler Versandweg.</p>
      </div>
      <div class="card">
        <div class="label">Grow am Rhein</div>
        <p class="info-block mt-12">Kölner Growshop für Equipment, kein typischer Stecklingszüchter. Keine selbst geprüfte Bewertungsnote.</p>
      </div>
    </div>`;
}

function renderExport() {
  const json = JSON.stringify(exportPayload(state.grows, state.activeId), null, 2);
  return `${topBar("Export / Import", "Nur JSON-Text, kein PDF", "mehr")}
    <div class="grid">
      <div class="card">
        <div class="label">Export</div>
        <textarea class="mt-12 mono" id="export-box" readonly>${esc(json)}</textarea>
        <button class="btn primary mt-12" data-action="copy-export">Text kopieren</button>
      </div>
      <div class="card">
        <div class="label">Import</div>
        <textarea class="mt-12 mono" data-field="import-text" placeholder="{ … }">${esc(importText)}</textarea>
        <button class="btn mt-12" data-action="do-import">Übernehmen</button>
        ${notice ? `<p class="sub mt-12">${esc(notice)}</p>` : ""}
      </div>
    </div>`;
}

function renderWizard() {
  if (!wizard) startWizard();
  const d = wizard.draft;
  const step = wizard.step;
  const total = 6;
  const titles = ["Name", "Start", "Pflanzen", "Zelt", "Substrat", "Töpfe"];
  let body = "";
  if (step === 0) {
    body = `<div class="field"><label class="label">Name</label><input data-wiz="name" value="${esc(d.name)}"></div>`;
  } else if (step === 1) {
    body = `<button class="btn primary" data-action="wiz-today">Heute starten</button>
      <div class="field mt-16"><label class="label">oder Datum</label><input type="date" data-wiz="startDate" value="${esc(d.startDate)}"></div>`;
  } else if (step === 2) {
    body = `<div class="stepper">
      <button type="button" data-action="wiz-plants" data-delta="-1">−</button>
      <div class="val">${nfmt(d.plants)}</div>
      <button type="button" data-action="wiz-plants" data-delta="1">+</button>
    </div>
    ${Number(d.plants) > 3 ? `<div class="warn-note mt-16">Gesetzlich höchstens 3 Pflanzen pro erwachsener Person.</div>` : ""}`;
  } else if (step === 3) {
    body = `<div class="grid-2">
      <div class="field"><label class="label">Breite cm</label><input inputmode="decimal" data-wiz="tentWcm" value="${esc(d.tentWcm)}"></div>
      <div class="field"><label class="label">Länge cm</label><input inputmode="decimal" data-wiz="tentLcm" value="${esc(d.tentLcm)}"></div>
    </div>
    <div class="field mt-12"><label class="label">Höhe cm</label><input inputmode="decimal" data-wiz="tentHcm" value="${esc(d.tentHcm)}"></div>`;
  } else if (step === 4) {
    body = `<div class="tiles">
      <button class="tile ${d.substrate === "erde" ? "on" : ""}" data-action="wiz-sub" data-value="erde">Erde</button>
      <button class="tile ${d.substrate === "kokos" ? "on" : ""}" data-action="wiz-sub" data-value="kokos">Kokos</button>
      <button class="tile ${d.substrate === "custom" ? "on" : ""}" data-action="wiz-sub" data-value="custom">Eigene</button>
    </div>
    ${d.substrate === "custom" ? `<div class="field mt-16"><label class="label">Substrat</label><input data-wiz="substrateCustom" value="${esc(d.substrateCustom)}"></div>` : ""}`;
  } else {
    body = `<div class="field"><label class="label">Topf liter</label><input inputmode="decimal" data-wiz="potL" value="${esc(d.potL)}"></div>
      <div class="field mt-12"><label class="label">Tank liter</label><input inputmode="decimal" data-wiz="tankL" value="${esc(d.tankL)}"></div>
      <p class="sub mt-16">Lampe: Omega Infinity 600W Pro 3.0. Dünger: Athena Blended. Beides kannst du später ändern.</p>`;
  }
  return `${topBar("Neuer Grow", `<span class="wizard-step">Schritt ${step + 1} / ${total} · ${esc(titles[step])}</span>`)}
    <div class="progress"><span style="width:${((step + 1) / total) * 100}%"></span></div>
    <div class="card mt-16">${body}</div>
    <div class="btn-row mt-16">
      <button class="btn" data-action="wiz-prev" ${step === 0 ? "disabled" : ""}>Zurück</button>
      ${step < total - 1
        ? `<button class="btn primary" data-action="wiz-next">Weiter</button>`
        : `<button class="btn primary" data-action="wiz-finish">Starten</button>`}
    </div>`;
}

const screens = {
  heute: renderHeute,
  plan: renderPlan,
  duenger: renderDuenger,
  lampe: renderLampe,
  mehr: renderMehr,
  grows: renderGrows,
  info: renderInfo,
  export: renderExport,
  wizard: renderWizard,
};

function render() {
  const fn = screens[route] || renderHeute;
  $app.innerHTML = fn();
  $app.className = "app";
  if (route === "plan") {
    queueMicrotask(scrollPlanToIndex);
    setTimeout(scrollPlanToIndex, 60);
  }
}

function scrollPlanToIndex() {
  const track = document.getElementById("week-track");
  if (!track) return;
  const slide = track.querySelectorAll(".week-slide")[planIndex];
  if (!slide) return;
  const left = slide.offsetLeft;
  track.scrollLeft = left;
  requestAnimationFrame(() => {
    track.scrollLeft = left;
  });
}

function syncPlanFromScroll() {
  const track = document.getElementById("week-track");
  if (!track) return;
  const i = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
  if (i !== planIndex && i >= 0 && i < WEEK_COUNT) {
    planIndex = i;
    const dots = $app.querySelectorAll(".dots i");
    dots.forEach((el, idx) => el.classList.toggle("on", idx === planIndex));
  }
}

function parseNum(value) {
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function onClick(e) {
  const go = e.target.closest("[data-go]");
  if (go) {
    setRoute(go.getAttribute("data-go"));
    return;
  }
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  const grow = currentGrow();
  if (action === "water" && grow) {
    patchGrow((g) => { g.waterings = addWatering(g.waterings, todayISO()); });
    return;
  }
  if (action === "plan-prev") {
    planIndex = Math.max(0, planIndex - 1);
    render();
    return;
  }
  if (action === "plan-next") {
    planIndex = Math.min(WEEK_COUNT - 1, planIndex + 1);
    render();
    return;
  }
  if (action === "fert-add" && grow) {
    const id = `p-${Date.now()}`;
    patchGrow((g) => {
      const plan = growPlan(g);
      plan.presetId = "custom";
      plan.products.push({
        id, name: "Neu", unit: "ml/L",
        doses: Array.from({ length: WEEK_COUNT }, () => null),
        ranges: Array.from({ length: WEEK_COUNT }, () => null),
      });
      g.plan = plan;
      fertProductId = id;
    });
    return;
  }
  if (action === "fert-del" && grow && fertProductId) {
    patchGrow((g) => {
      const plan = growPlan(g);
      plan.presetId = "custom";
      plan.products = plan.products.filter((p) => p.id !== fertProductId);
      g.plan = plan;
      fertProductId = plan.products[0] ? plan.products[0].id : "";
    });
    return;
  }
  if (action === "fert-reset" && grow) {
    patchGrow((g) => { g.plan = buildAthenaPlan(); });
    fertProductId = "";
    return;
  }
  if (action === "lamp-preset" && grow) {
    patchGrow((g) => { g.lampId = OMEGA_LAMP.id; g.lampType = "bar"; });
    return;
  }
  if (action === "lamp-type" && grow) {
    const typ = btn.getAttribute("data-value");
    if (typ === "bar" || typ === "panel" || typ === "spot") {
      patchGrow((g) => { g.lampType = typ; });
    }
    return;
  }
  if (action === "ppfd-add" && grow) {
    const kind = btn.getAttribute("data-kind") === "read" ? "readings" : "manufacturer";
    patchGrow((g) => {
      const ref = normalizePpfdRef(g.ppfdRef);
      const blank = kind === "readings"
        ? { heightCm: "", dimPct: 100, ppfdCenter: "", ppfdEdge: "" }
        : { heightCm: "", ppfdAvg: "", dimPct: 100, areaM2: tentAreaM2(g.tent) || "" };
      ref[kind].push(blank);
      g.ppfdRef = ref;
    });
    return;
  }
  if (action === "ppfd-del" && grow) {
    const kind = btn.getAttribute("data-kind") === "read" ? "readings" : "manufacturer";
    const idx = Number(btn.getAttribute("data-index"));
    patchGrow((g) => {
      const ref = normalizePpfdRef(g.ppfdRef);
      if (Number.isFinite(idx)) ref[kind].splice(idx, 1);
      g.ppfdRef = ref;
    });
    return;
  }
  if (action === "lamp-custom" && grow) {
    patchGrow((g) => {
      g.lampId = "custom";
      if (!g.customLamp) g.customLamp = { name: "Eigene Lampe", watts: 600, ppf: "", umolPerJ: 2.8, widthM: 1.2, lengthM: 1.2, dimSteps: [0, 25, 50, 75, 100] };
    });
    return;
  }
  if (action === "lamp-save-custom" && grow) {
    patchGrow((g) => { g.lampId = "custom"; });
    return;
  }
  if (action === "select-grow") {
    state.activeId = btn.getAttribute("data-id");
    persist();
    setRoute("heute");
    return;
  }
  if (action === "del-grow") {
    const id = btn.getAttribute("data-id");
    if (window.confirm("Diesen Grow löschen?")) {
      state = deleteGrow(state, id);
      persist();
      render();
    }
    return;
  }
  if (action === "copy-export") {
    const box = document.getElementById("export-box");
    if (box) {
      box.select();
      navigator.clipboard && navigator.clipboard.writeText(box.value);
    }
    notice = "Kopiert.";
    render();
    return;
  }
  if (action === "do-import") {
    const parsed = parseExport(importText);
    if (!parsed) {
      notice = "JSON nicht lesbar. Nur der exportierte Text, kein PDF.";
      render();
      return;
    }
    const existing = new Map((state.grows || []).map((g) => [g.id, g]));
    for (const g of parsed.grows) existing.set(g.id, g);
    state = { version: 1, grows: [...existing.values()], activeId: parsed.activeId || state.activeId };
    persist();
    notice = "Import übernommen.";
    render();
    return;
  }
  if (action === "install" && deferredInstall) {
    deferredInstall.prompt();
    deferredInstall = null;
    render();
    return;
  }
  if (action === "wiz-today") {
    wizard.draft.startDate = todayISO();
    wizard.step = Math.min(wizard.step + 1, 5);
    render();
    return;
  }
  if (action === "wiz-plants") {
    const delta = Number(btn.getAttribute("data-delta")) || 0;
    wizard.draft.plants = Math.max(1, Number(wizard.draft.plants) + delta);
    render();
    return;
  }
  if (action === "wiz-sub") {
    wizard.draft.substrate = btn.getAttribute("data-value");
    render();
    return;
  }
  if (action === "wiz-prev") {
    wizard.step = Math.max(0, wizard.step - 1);
    render();
    return;
  }
  if (action === "wiz-next") {
    wizard.step = Math.min(5, wizard.step + 1);
    render();
    return;
  }
  if (action === "wiz-finish") {
    finishWizard();
  }
}

function fertWeekIndex() {
  const grow = currentGrow();
  if (!grow) return 0;
  const sel = $app.querySelector("[data-action=fert-week]");
  if (sel) return Number(sel.value);
  const prog = progressFor(grow);
  return prog.weekIndex;
}

function onChange(e) {
  const field = e.target.closest("[data-field]");
  const wiz = e.target.closest("[data-wiz]");
  if (wiz && wizard) {
    const key = wiz.getAttribute("data-wiz");
    wizard.draft[key] = e.target.value;
    return;
  }
  if (e.target.matches("[data-action=fert-week]")) {
    planIndex = Number(e.target.value) || 0;
    render();
    return;
  }
  if (e.target.matches("[data-action=fert-product]")) {
    fertProductId = e.target.value;
    render();
    return;
  }
  if (!field) return;
  const name = field.getAttribute("data-field");
  const grow = currentGrow();
  if (name === "import-text") {
    importText = e.target.value;
    return;
  }
  if (!grow) return;
  if (name === "tankL") {
    patchGrow((g) => { g.tankL = parseNum(e.target.value) || 10; });
    return;
  }
  if (name === "flip-date") {
    patchGrow((g) => { g.flipDate = e.target.value || ""; });
    return;
  }
  if (name.startsWith("ppfd-")) {
    const parts = name.split("-");
    const kind = parts[1] === "read" ? "readings" : "manufacturer";
    const key = parts.slice(2).join("-");
    const idx = Number(e.target.getAttribute("data-index"));
    patchGrow((g) => {
      const ref = normalizePpfdRef(g.ppfdRef);
      if (!ref[kind][idx]) ref[kind][idx] = {};
      const raw = e.target.value.trim();
      ref[kind][idx][key] = raw === "" ? "" : (parseNum(raw) ?? raw);
      g.ppfdRef = ref;
    });
    return;
  }
  if (name.startsWith("cl-")) {
    patchGrow((g) => {
      const c = { ...(g.customLamp || {}) };
      if (name === "cl-name") c.name = e.target.value;
      if (name === "cl-watts") c.watts = parseNum(e.target.value);
      if (name === "cl-eff") c.umolPerJ = parseNum(e.target.value);
      if (name === "cl-ppf") c.ppf = parseNum(e.target.value);
      if (name === "cl-w") c.widthM = (parseNum(e.target.value) || 0) / 100;
      if (name === "cl-l") c.lengthM = (parseNum(e.target.value) || 0) / 100;
      if (name === "cl-steps") c.dimSteps = e.target.value.split(/[,/ ]+/).map((x) => Number(x)).filter((n) => Number.isFinite(n));
      g.customLamp = c;
      g.lampId = "custom";
    });
    return;
  }
  const idx = fertWeekIndex();
  if (name === "prod-name" || name === "prod-unit" || name === "prod-dose") {
    patchGrow((g) => {
      const plan = growPlan(g);
      const p = plan.products.find((x) => x.id === fertProductId);
      if (!p) return;
      plan.presetId = "custom";
      if (name === "prod-name") p.name = e.target.value;
      if (name === "prod-unit") p.unit = e.target.value === "g/L" ? "g/L" : "ml/L";
      if (name === "prod-dose") {
        p.doses[idx] = parseNum(e.target.value);
        p.ranges[idx] = null;
      }
      g.plan = plan;
    });
    return;
  }
  if (name === "target-ec" || name === "target-ph") {
    patchGrow((g) => {
      const plan = growPlan(g);
      const t = plan.weekTargets[idx] || { ec: null, pH: "" };
      if (name === "target-ec") t.ec = parseNum(e.target.value);
      if (name === "target-ph") t.pH = e.target.value;
      plan.weekTargets[idx] = t;
      plan.presetId = "custom";
      g.plan = plan;
    });
  }
}

function seedDemo() {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 24);
  const lastWater = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
  const grow = defaultGrow({
    id: "demo-grow",
    name: "Zelt Nord",
    startDate: toISODate(start),
    plants: 3,
    tent: { widthM: 1.2, lengthM: 1.2, heightM: 2 },
    substrate: "erde",
    potL: 25,
    tankL: 10,
    lampId: OMEGA_LAMP.id,
    plan: buildAthenaPlan(),
    waterings: [toISODate(lastWater)],
  });
  state = upsertGrow(emptyState(), grow);
}

async function init() {
  try {
    const res = await fetch("data/grow_plan_data.json");
    DATA = await res.json();
  } catch (err) {
    $app.textContent = "Daten konnten nicht geladen werden. Bitte die App über http:// starten, nicht als Datei.";
    return;
  }
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") {
    seedDemo();
    await persist();
  } else {
    state = await loadState();
  }
  route = parseHash();
  if (route === "plan") {
    const grow = currentGrow();
    if (grow) planIndex = progressFor(grow).weekIndex;
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
  });
  window.addEventListener("hashchange", () => {
    route = parseHash();
    if (route === "plan" && currentGrow()) planIndex = progressFor(currentGrow()).weekIndex;
    render();
  });
  $app.addEventListener("click", onClick);
  $app.addEventListener("change", onChange);
  $app.addEventListener("input", (e) => {
    if (e.target.matches("[data-field=import-text], [data-wiz]")) onChange(e);
  });
  $app.addEventListener("scroll", (e) => {
    if (e.target.id === "week-track") syncPlanFromScroll();
  }, true);
  setInterval(() => {
    now = new Date();
    if (route === "heute" && currentGrow() && currentGrow().startDate) {
      const cycle = cycleOverview(currentGrow().startDate, now, WEEK_COUNT, currentGrow().flipDate);
      const box = $app.querySelector(".countdown");
      if (box && cycle.harvestAt) {
        const cd = countdownParts(cycle.harvestAt, now);
        const nums = box.querySelectorAll(".num");
        if (nums.length === 4) {
          nums[0].textContent = String(cd.days);
          nums[1].textContent = pad2(cd.hours);
          nums[2].textContent = pad2(cd.minutes);
          nums[3].textContent = pad2(cd.seconds);
        }
        const hero = $app.querySelector(".num-xl");
        if (hero && !cd.overdue) hero.textContent = String(cd.days);
      }
    }
  }, 1000);
  render();
}

init();
