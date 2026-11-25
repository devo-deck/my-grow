import puppeteer from "/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = "/workspace/grow-app/screenshots";
const BASE = "http://127.0.0.1:8765";
const chrome = process.env.CHROME || "/usr/bin/google-chrome-stable";
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars", "--lang=de-DE"],
  env: { ...process.env, LANG: "de_DE.UTF-8", LANGUAGE: "de-DE" },
});
const page = await browser.newPage();
await page.emulateTimezone("Europe/Berlin");
await page.setExtraHTTPHeaders({ "Accept-Language": "de-DE,de;q=0.9" });
await page.setViewport({ width: 393, height: 873, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.setDefaultTimeout(15000);

async function shot(name, hash, after) {
  const url = `${BASE}/?demo=1&s=${name}${hash}`;
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector(".app h1");
  if (after) await after(page);
  await new Promise((r) => setTimeout(r, 350));
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: "png" });
  console.log("wrote", file);
}

await shot("heute", "#/heute", async (page) => {
  await new Promise((r) => setTimeout(r, 1200));
  const nums = await page.evaluate(() => {
    const hero = document.querySelector(".num-xl");
    const cd = [...document.querySelectorAll(".countdown .num")].map((n) => n.textContent);
    return { hero: hero && hero.textContent, cd };
  });
  console.log("heute nums", nums);
});
await shot("plan", "#/plan", async (page) => {
  await new Promise((r) => setTimeout(r, 120));
  const title = await page.$eval(".week-slide .num, .week-slide h1, .week-slide", (el) => {
    const n = el.closest(".week-track") || document;
    const slides = [...document.querySelectorAll(".week-slide")];
    const track = document.getElementById("week-track");
    return JSON.stringify({
      scroll: track && track.scrollLeft,
      count: slides.length,
      text: slides[3] ? slides[3].innerText.slice(0, 80) : "no-3",
      first: slides[0] ? slides[0].innerText.slice(0, 40) : "",
    });
  });
  console.log("plan state", title);
});
await shot("duenger", "#/duenger");
await shot("lampe", "#/lampe");
await shot("lampe-ppfd", "#/lampe", async (page) => {
  await page.waitForSelector("#ppfd-inputs");
  await page.$eval("#ppfd-inputs", (el) => el.scrollIntoView({ block: "start" }));
  await new Promise((r) => setTimeout(r, 200));
});
await shot("plan-start", "#/plan", async (page) => {
  await page.waitForSelector("#week-track");
  await new Promise((r) => setTimeout(r, 220));
  await page.$eval("#week-track", (el) => { el.scrollLeft = 0; });
  await new Promise((r) => setTimeout(r, 200));
  const text = await page.evaluate(() => {
    const track = document.getElementById("week-track");
    const slides = [...document.querySelectorAll(".week-slide")];
    return { scroll: track.scrollLeft, text: slides[0] ? slides[0].innerText.slice(0, 320) : "" };
  });
  console.log("plan-start", text);
});
await shot("mehr", "#/mehr");
await shot("grows", "#/grows");
await shot("info", "#/info");
await shot("wizard", "#/wizard");
await shot("export", "#/export");

await page.goto(`${BASE}/?demo=1&s=schema#/duenger`, { waitUntil: "networkidle0" });
await page.waitForSelector(".schema-wrap");
const scrolled = await page.$eval(".schema-wrap", (el) => {
  el.scrollLeft = 520;
  return { left: el.scrollLeft, width: el.scrollWidth, client: el.clientWidth };
});
console.log("schema scroll", scrolled);
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(OUT, "duenger-schema-later.png"), type: "png" });
console.log("wrote duenger-schema-later.png");

await browser.close();
