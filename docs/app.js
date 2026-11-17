import { analyze, settings, validate, SOURCES } from "./core.js";
const $ = (id) => document.getElementById(id),
  put = (id, v) => {
    $(id).textContent = v;
  },
  fmt = (v, d = 5) => (v === null ? "undefined" : v.toFixed(d)),
  prediction = (v) => (v === null ? "Not scored (missing input)" : fmt(v));
let state = settings(),
  result,
  day = 140;
function rows(id, data) {
  const fragment = document.createDocumentFragment();
  for (const cells of data) {
    const tr = document.createElement("tr");
    for (const v of cells) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    fragment.append(tr);
  }
  $(id).replaceChildren(fragment);
}
function cards(id, records) {
  const frag = document.createDocumentFragment();
  records.forEach((record, source) => {
    const card = document.createElement("section");
    card.className = "record-card";
    const title = document.createElement("h4");
    title.textContent = SOURCES[source];
    card.append(title);
    if (!record) {
      const p = document.createElement("p");
      p.className = "record-note";
      p.textContent =
        "Missing: no eligible observation within 8 days. No future fill or imputation.";
      card.append(p);
    } else {
      const value = document.createElement("p");
      value.className = "value";
      value.textContent = fmt(record.value, 4);
      card.append(value);
      const dl = document.createElement("dl");
      for (const [label, text] of [
        ["Observation", record.observation],
        ["Available", record.available],
        ["Age", `${day - record.observation} days`],
      ]) {
        const group = document.createElement("div"),
          dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = text;
        if (label === "Available" && record.available > day)
          dd.className = "late";
        group.append(dt, dd);
        dl.append(group);
      }
      card.append(dl);
      const note = document.createElement("p");
      note.className = "record-note";
      note.textContent = `Record #${record.id} · ${record.vintage ? "revision" : "first release"} · ${record.available > day ? "UNAVAILABLE at this decision" : "known at this decision"}`;
      if (record.available > day) note.classList.add("late");
      card.append(note);
    }
    frag.append(card);
  });
  $(id).replaceChildren(frag);
}
function audit() {
  const row = result.rows[day - 20];
  put("day-label", day);
  $("day").value = String(day);
  $("prev").disabled = day === 20;
  $("next").disabled = day === 219;
  put(
    "row-status",
    `${row.partition === "formation" ? "Formation" : "Test"} decision ${day} · target available day ${row.label_available} · ${row.included ? "Included in the common complete-row cohort." : row.exclusion + " Excluded from both lenses and baseline."}`,
  );
  cards("known-cards", row.known);
  cards("revised-cards", row.revised);
  put("known-pred", prediction(row.known_prediction));
  put("revised-pred", prediction(row.revised_prediction));
  put("target", fmt(row.target));
}
function chart() {
  const c = $("predictions"),
    w = Math.floor(c.getBoundingClientRect().width),
    h = Math.floor(c.getBoundingClientRect().height),
    ratio = devicePixelRatio || 1;
  c.width = w * ratio;
  c.height = h * ratio;
  const ctx = c.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.font = "10px system-ui";
  const data = result.rows.filter((r) => r.partition === "test"),
    values = data
      .flatMap((r) => [r.target, r.known_prediction, r.revised_prediction])
      .filter((v) => v !== null),
    min = Math.min(...values) - 0.003,
    max = Math.max(...values) + 0.003,
    l = 48,
    r = 20,
    t = 14,
    b = 36,
    px = (d) => l + ((d - 140) / 79) * (w - l - r),
    py = (v) => t + ((max - v) / (max - min)) * (h - t - b);
  ctx.fillStyle = "#67727e";
  ctx.strokeStyle = "#dce1d9";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(l, py(v));
    ctx.lineTo(w - r, py(v));
    ctx.stroke();
    ctx.fillText(v.toFixed(3), l - 6, py(v) + 3);
  }
  for (const [field, color] of [
    ["target", "#849098"],
    ["known_prediction", "#256977"],
    ["revised_prediction", "#a9472f"],
  ]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = field === "target" ? 1 : 1.7;
    ctx.beginPath();
    let open = false;
    for (const row of data) {
      if (!row.included || row[field] === null) {
        open = false;
        continue;
      }
      if (open) ctx.lineTo(px(row.decision), py(row[field]));
      else ctx.moveTo(px(row.decision), py(row[field]));
      open = true;
    }
    ctx.stroke();
  }
  ctx.fillStyle = "#67727e";
  ctx.textAlign = "center";
  for (const d of [140, 180, 219]) ctx.fillText(String(d), px(d), h - 20);
  ctx.fillText("Decision day", l + (w - l - r) / 2, h - 2);
}
function render() {
  result = analyze(state);
  put("world-title", result.name);
  put("world-description", result.description);
  put(
    "status",
    "Both lenses and the frozen-mean baseline use common complete rows. Only formation labels available by day 140 enter either fit. Hindsight ignores the release clock and is not deployable.",
  );
  put("rmse", fmt(result.scores[0].rmse));
  put("leaks", result.summary.known_future_records);
  put(
    "hindsight-leaks",
    `${result.summary.revised_future_records} future-release selections in the hindsight lens, across all 200 decisions`,
  );
  put("count", `${result.summary.test_included} / 80`);
  put(
    "excluded",
    `${result.summary.excluded} of 200 decisions excluded; no imputation`,
  );
  rows(
    "score-rows",
    result.scores.map((s) => [
      s.name,
      s.count,
      fmt(s.rmse),
      fmt(s.mae),
      fmt(s.skill, 3),
    ]),
  );
  const a = result.known_fit,
    b = result.revised_fit,
    fitrows = [
      ["Formation rows", a?.count ?? null, b?.count ?? null],
      ["Intercept", a?.intercept ?? null, b?.intercept ?? null],
      ...SOURCES.flatMap((name, j) => [
        [`${name}: mean`, a?.means[j] ?? null, b?.means[j] ?? null],
        [`${name}: scale`, a?.scales[j] ?? null, b?.scales[j] ?? null],
        [`${name}: β`, a?.beta[j] ?? null, b?.beta[j] ?? null],
      ]),
    ];
  rows(
    "fit-rows",
    fitrows.map(([label, x, y], i) => [
      label,
      i === 0 ? String(x) : fmt(x, 6),
      i === 0 ? String(y) : fmt(y, 6),
    ]),
  );
  rows(
    "decision-rows",
    result.rows.map((row) => [
      row.decision,
      row.partition,
      row.included ? "yes" : "no",
      row.known.map((v) => (v ? `#${v.id}` : "missing")).join(" / "),
      row.revised.map((v) => (v ? `#${v.id}` : "missing")).join(" / "),
      prediction(row.known_prediction),
      prediction(row.revised_prediction),
      fmt(row.target),
      row.label_available,
    ]),
  );
  rows(
    "record-rows",
    result.records.map((r) => [
      r.id,
      SOURCES[r.source],
      r.observation,
      r.available,
      r.vintage ? "revision" : "first release",
      fmt(r.value, 5),
    ]),
  );
  put(
    "record-summary",
    `All ${result.records.length} publication records, first releases and revisions`,
  );
  audit();
  chart();
}
for (const key of ["scenario", "delay"])
  $(key).addEventListener("change", (event) => {
    const next = { ...state, [key]: Number(event.target.value) };
    try {
      validate(next);
      state = next;
      render();
    } catch {
      event.target.value = String(state[key]);
      put(
        "status",
        "Invalid selection rejected. Previous pipeline remains unchanged.",
      );
    }
  });
$("day").addEventListener("input", (event) => {
  const candidate = Number(event.target.value);
  if (Number.isInteger(candidate) && candidate >= 20 && candidate <= 219)
    day = candidate;
  else event.target.value = String(day);
  audit();
});
$("prev").addEventListener("click", () => {
  day = Math.max(20, day - 1);
  audit();
});
$("next").addEventListener("click", () => {
  day = Math.min(219, day + 1);
  audit();
});
$("reset").addEventListener("click", () => {
  state = settings();
  day = 140;
  for (const key of ["scenario", "delay"]) $(key).value = String(state[key]);
  render();
});
$("download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "vintalane-pipeline.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let pending = false;
window.addEventListener("resize", () => {
  if (!pending) {
    pending = true;
    requestAnimationFrame(() => {
      chart();
      pending = false;
    });
  }
});
render();
