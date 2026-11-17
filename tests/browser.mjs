import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { analyze, SOURCES } from "../docs/core.js";
const base = process.env.BASE_URL || "http://127.0.0.1:8389/";
let server;
if (!process.env.BASE_URL) {
  server = spawn(
    "python3",
    ["-m", "http.server", "8389", "--directory", "docs", "--bind", "127.0.0.1"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
}
const browser = await chromium.launch({ headless: true });
await mkdir("/tmp/vintalane-shots", { recursive: true });
let count = 0;
const check = (v, m) => {
    count++;
    assert(v, m);
  },
  fmt = (v, d = 5) => (v === null ? "undefined" : v.toFixed(d)),
  prediction = (v) => (v === null ? "Not scored (missing input)" : fmt(v)),
  configs = [];
for (const scenario of [0, 1, 2])
  for (const delay of [0, 1]) configs.push({ scenario, delay });
const states = configs.map(analyze);
try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }),
      errors = [],
      third = [],
      failed = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("requestfailed", (r) => failed.push(r.url()));
    page.on("request", (r) => {
      if (!r.url().startsWith(base) && !r.url().startsWith("blob:"))
        third.push(r.url());
    });
    await page.goto(base);
    await page.locator("#status").filter({ hasText: "Both lenses" }).waitFor();
    async function table(id) {
      return page
        .locator("#" + id + " tr")
        .evaluateAll((rows) =>
          rows.map((tr) =>
            [...tr.querySelectorAll("td")].map((td) => td.textContent),
          ),
        );
    }
    async function audit(day, r) {
      await page.locator("#day").fill(String(day));
      await page.locator("#day").dispatchEvent("input");
      const row = r.rows[day - 20];
      check(
        (await page.locator("#day-label").textContent()) === String(day),
        "selected day",
      );
      check(
        (await page.locator("#known-pred").textContent()) ===
          prediction(row.known_prediction),
        "known prediction",
      );
      check(
        (await page.locator("#revised-pred").textContent()) ===
          prediction(row.revised_prediction),
        "revised prediction",
      );
      check(
        (await page.locator("#target").textContent()) === fmt(row.target),
        "target",
      );
      for (const lens of ["known", "revised"]) {
        const cards = await page
          .locator("#" + lens + "-cards .record-card")
          .all();
        check(cards.length === 2, "two sources");
        for (let j = 0; j < 2; j++) {
          const rec = row[lens][j];
          check(
            (await cards[j].locator("h4").textContent()) === SOURCES[j],
            "source",
          );
          if (rec) {
            check(
              (await cards[j].locator(".value").textContent()) ===
                fmt(rec.value, 4),
              "value",
            );
            check(
              JSON.stringify(await cards[j].locator("dd").allTextContents()) ===
                JSON.stringify([
                  String(rec.observation),
                  String(rec.available),
                  `${day - rec.observation} days`,
                ]),
              "lineage days",
            );
            check(
              (await cards[j].locator(".record-note").textContent()).includes(
                `#${rec.id} · ${rec.vintage ? "revision" : "first release"}`,
              ),
              "record provenance",
            );
            check(
              (await cards[j].locator(".record-note").textContent()).includes(
                rec.available > day ? "UNAVAILABLE" : "known at",
              ),
              "availability label",
            );
          } else
            check(
              (await cards[j].textContent()).includes("Missing:"),
              "explicit missing",
            );
        }
      }
    }
    async function verify(r) {
      for (const [id, v] of [
        ["rmse", fmt(r.scores[0].rmse)],
        ["leaks", "0"],
        ["count", `${r.summary.test_included} / 80`],
      ])
        check(
          (await page.locator("#" + id).textContent()) === v,
          `${width}:${id}`,
        );
      check(
        JSON.stringify(await table("score-rows")) ===
          JSON.stringify(
            r.scores.map((s) => [
              s.name,
              String(s.count),
              fmt(s.rmse),
              fmt(s.mae),
              fmt(s.skill, 3),
            ]),
          ),
        "all scores",
      );
      check(
        JSON.stringify(await table("decision-rows")) ===
          JSON.stringify(
            r.rows.map((v) => [
              String(v.decision),
              v.partition,
              v.included ? "yes" : "no",
              v.known.map((x) => (x ? `#${x.id}` : "missing")).join(" / "),
              v.revised.map((x) => (x ? `#${x.id}` : "missing")).join(" / "),
              prediction(v.known_prediction),
              prediction(v.revised_prediction),
              fmt(v.target),
              String(v.label_available),
            ]),
          ),
        "all200decisionrows",
      );
      check(
        JSON.stringify(await table("record-rows")) ===
          JSON.stringify(
            r.records.map((v) => [
              String(v.id),
              SOURCES[v.source],
              String(v.observation),
              String(v.available),
              v.vintage ? "revision" : "first release",
              fmt(v.value),
            ]),
          ),
        "all816records",
      );
      const a = r.known_fit,
        b = r.revised_fit,
        data = [
          ["Formation rows", String(a.count), String(b.count)],
          ["Intercept", fmt(a.intercept, 6), fmt(b.intercept, 6)],
          ...SOURCES.flatMap((s, j) => [
            [`${s}: mean`, fmt(a.means[j], 6), fmt(b.means[j], 6)],
            [`${s}: scale`, fmt(a.scales[j], 6), fmt(b.scales[j], 6)],
            [`${s}: β`, fmt(a.beta[j], 6), fmt(b.beta[j], 6)],
          ]),
        ];
      check(
        JSON.stringify(await table("fit-rows")) === JSON.stringify(data),
        "all preprocessing+coefficients",
      );
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "no page overflow",
      );
      check(
        await page.locator("#predictions").evaluate(
          (c) =>
            c.width >= Math.floor(c.getBoundingClientRect().width) &&
            c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height)
              .data.some((v, i) => i % 4 === 3 && v > 0),
        ),
        "canvas dimensions and ink",
      );
    }
    await verify(states[0]);
    if (width === 1440)
      await page.screenshot({
        path: "/tmp/vintalane-shots/desktop.png",
        fullPage: true,
      });
    for (let i = 0; i < configs.length; i++) {
      const c = configs[i];
      await page.locator("#scenario").selectOption(String(c.scenario));
      await page.locator("#delay").selectOption(String(c.delay));
      await verify(states[i]);
      for (const day of [20, 90, 100, 140, 185, 219])
        await audit(day, states[i]);
      if ((width === 320 || width === 1440) && i === 1) {
        await audit(90, states[i]);
        await page.screenshot({
          path: `/tmp/vintalane-shots/${width === 320 ? "mobile" : "desktop"}-missing.png`,
          fullPage: true,
        });
      }
      if (width === 320 && i === 5) {
        await audit(140, states[i]);
        await page.screenshot({
          path: "/tmp/vintalane-shots/mobile-reversal.png",
          fullPage: true,
        });
      }
    }
    await page.locator("#reset").click();
    await verify(states[0]);
    check((await page.locator("#day").inputValue()) === "140", "reset day");
    await page.locator("#prev").click();
    check(
      (await page.locator("#day-label").textContent()) === "139",
      "previous",
    );
    await page.locator("#next").click();
    check((await page.locator("#day-label").textContent()) === "140", "next");
    await audit(20, states[0]);
    check(await page.locator("#prev").isDisabled(), "lowerbound");
    await audit(219, states[0]);
    check(await page.locator("#next").isDisabled(), "upperbound");
    await page.locator("#reset").click();
    for (const d of await page.locator("details").all())
      await d.locator("summary").click();
    if (width === 320)
      await page
        .locator(".ledgers")
        .screenshot({ path: "/tmp/vintalane-shots/mobile-ledgers.png" });
    const dl = page.waitForEvent("download");
    await page.locator("#download").click();
    const download = await dl;
    check(
      JSON.stringify(
        JSON.parse(await readFile(await download.path(), "utf8")),
      ) === JSON.stringify(states[0]),
      "full export",
    );
    await page.locator("#scenario").evaluate((e) => {
      const o = document.createElement("option");
      o.value = "9";
      e.append(o);
      e.value = "9";
      e.dispatchEvent(new Event("change", { bubbles: true }));
    });
    check(
      (await page.locator("#status").textContent()).startsWith(
        "Invalid selection rejected",
      ),
      "invalid rejected",
    );
    check(
      (await page.locator("#scenario").inputValue()) === "0",
      "invalid restored",
    );
    check(
      (await page.locator("#rmse").textContent()) ===
        fmt(states[0].scores[0].rmse),
      "lastresultretained",
    );
    check((await page.context().cookies()).length === 0, "nocookies");
    check(
      await page.evaluate(
        () => localStorage.length === 0 && sessionStorage.length === 0,
      ),
      "nostorage",
    );
    check(
      await page.evaluate(async () =>
        navigator.serviceWorker
          ? (await navigator.serviceWorker.getRegistrations()).length === 0
          : true,
      ),
      "noSW",
    );
    check(errors.length === 0, JSON.stringify(errors));
    check(failed.length === 0, JSON.stringify(failed));
    check(third.length === 0, JSON.stringify(third));
    await page.close();
  }
  console.log(
    `${count} Chromium assertions; 5 widths, 6 configs, full 200 decisions / 816 records / fit values / clock audits / reset / export / privacy PASS`,
  );
} finally {
  await browser.close();
  if (server) {
    server.kill();
    await new Promise((r) => server.once("close", r));
  }
}
