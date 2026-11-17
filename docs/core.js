export const SOURCES = ["Footfall proxy", "Shipments proxy"],
  WORLDS = [
    [
      "An engineered relationship",
      "Future synthetic outcomes contain the same hidden activity components as the proxies. The relationship is put in by construction, not discovered alpha.",
    ],
    [
      "An independent outcome",
      "Outcome noise is generated separately from activity. Any finite-sample fit or score difference is not evidence of a real predictive relationship.",
    ],
    [
      "A later coefficient reversal",
      "Formation outcomes exactly match the engineered world. The relationship reverses in the test period; no model is refitted.",
    ],
  ],
  LAMBDA = 8,
  TTL = 8,
  FIT_CLOCK = 140;
export const settings = () => ({ scenario: 0, delay: 0 });
export function validate(c) {
  if (
    !c ||
    Object.getPrototypeOf(c) !== Object.prototype ||
    Object.keys(c).sort().join(",") !== "delay,scenario"
  )
    throw new Error("settings require exactly scenario and delay");
  for (const [k, max] of [
    ["scenario", 2],
    ["delay", 1],
  ])
    if (!Number.isInteger(c[k]) || c[k] < 0 || c[k] > max)
      throw new Error(`${k} must be an integer in 0..${max}`);
}
export class Random {
  constructor(seed) {
    this.state = seed;
  }
  draw() {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 2147483648 - 1;
  }
}
const sum = (a) => a.reduce((v, x) => v + x, 0);
export function generate(scenario, delay) {
  const rng = new Random(41813),
    outcome_rng = new Random(77417),
    records = [],
    outcomes = [];
  let a = 0,
    b = 0;
  for (let day = 0; day < 220; day++) {
    a = 0.8 * a + 0.9 * rng.draw();
    b = 0.6 * b + 0.3 * a + 0.7 * rng.draw();
    const draws = Array.from({ length: 4 }, () => rng.draw()),
      noise = 0.014 * outcome_rng.draw(),
      signal = 0.012 * a - 0.008 * b,
      target =
        scenario === 1
          ? noise
          : (scenario === 2 && day >= 140 ? -signal : signal) + noise;
    outcomes.push({ decision: day, label_available: day + 1, target });
    for (let source = 0; source < 2; source++) {
      if (
        source === 1 &&
        ((day >= 80 && day <= 95) || (day >= 175 && day <= 190))
      )
        continue;
      const latent = source === 0 ? a : b;
      for (let vintage = 0; vintage < 2; vintage++) {
        const value =
            latent +
            (vintage === 0 ? 0.5 * draws[source] : 0.04 * draws[source + 2]),
          lag =
            [
              [1, 6],
              [3, 8],
            ][source][vintage] +
            3 * delay;
        records.push({
          id: records.length + 1,
          source,
          observation: day,
          available: day + lag,
          vintage,
          value,
        });
      }
    }
  }
  return [records, outcomes];
}
export function select(records, source, decision, hindsight = false) {
  let best = null;
  for (const r of records) {
    if (
      r.source !== source ||
      decision - r.observation < 0 ||
      decision - r.observation > TTL ||
      (!hindsight && r.available > decision)
    )
      continue;
    if (
      !best ||
      r.observation > best.observation ||
      (r.observation === best.observation &&
        (r.available > best.available ||
          (r.available === best.available && r.id > best.id)))
    )
      best = r;
  }
  return best;
}
export function assemble(records, outcomes) {
  return outcomes.slice(20, 220).map((outcome) => {
    const day = outcome.decision,
      known = [0, 1].map((s) => select(records, s, day)),
      revised = [0, 1].map((s) => select(records, s, day, true)),
      complete = [...known, ...revised].every((r) => r !== null);
    return {
      ...outcome,
      partition: day < FIT_CLOCK ? "formation" : "test",
      known,
      revised,
      included: complete,
      exclusion: complete
        ? ""
        : "A required proxy has no eligible observation within 8 days.",
    };
  });
}
export function fit(rows, lens) {
  const usable = rows.filter(
    (r) =>
      r.included &&
      r.partition === "formation" &&
      r.label_available <= FIT_CLOCK,
  );
  if (usable.length < 3) return null;
  const x = usable.map((r) => r[lens].map((v) => v.value)),
    y = usable.map((r) => r.target),
    n = x.length,
    means = [0, 1].map((j) => sum(x.map((row) => row[j])) / n),
    variances = [0, 1].map(
      (j) => sum(x.map((row) => (row[j] - means[j]) ** 2)) / n,
    ),
    scales = variances.map((v) => (v > 1e-24 ? Math.sqrt(v) : 1)),
    z = x.map((row) => [0, 1].map((j) => (row[j] - means[j]) / scales[j])),
    mean_y = sum(y) / n,
    s00 = sum(z.map((v) => v[0] ** 2)) + LAMBDA,
    s11 = sum(z.map((v) => v[1] ** 2)) + LAMBDA,
    s01 = sum(z.map((v) => v[0] * v[1])),
    rhs = [0, 1].map((j) => sum(z.map((v, i) => v[j] * (y[i] - mean_y)))),
    det = s00 * s11 - s01 * s01,
    beta = [
      (rhs[0] * s11 - rhs[1] * s01) / det,
      (rhs[1] * s00 - rhs[0] * s01) / det,
    ];
  return {
    lens,
    count: n,
    row_ids: usable.map((r) => r.decision),
    means,
    scales,
    constant_features: variances.map((v) => v <= 1e-24),
    intercept: mean_y,
    beta,
    gram: [
      [s00, s01],
      [s01, s11],
    ],
    rhs,
    lambda: LAMBDA,
    fit_clock: FIT_CLOCK,
  };
}
export function predict(model, row, lens) {
  if (!model || !row.included) return null;
  return (
    model.intercept +
    sum(
      [0, 1].map(
        (j) =>
          (model.beta[j] * (row[lens][j].value - model.means[j])) /
          model.scales[j],
      ),
    )
  );
}
export function metrics(rows, field, baseline_mse = null) {
  const usable = rows.filter(
    (r) => r.included && r.partition === "test" && r[field] !== null,
  );
  if (!usable.length)
    return { count: 0, mse: null, rmse: null, mae: null, skill: null };
  const errors = usable.map((r) => r[field] - r.target),
    mse = sum(errors.map((e) => e * e)) / errors.length;
  return {
    count: errors.length,
    mse,
    rmse: Math.sqrt(mse),
    mae: sum(errors.map(Math.abs)) / errors.length,
    skill:
      baseline_mse !== null && baseline_mse > 1e-24
        ? 1 - mse / baseline_mse
        : null,
  };
}
export function analyze(value = settings()) {
  validate(value);
  const c = { ...value },
    [records, outcomes] = generate(c.scenario, c.delay),
    rows = assemble(records, outcomes),
    known = fit(rows, "known"),
    revised = fit(rows, "revised");
  for (const r of rows) {
    r.known_prediction = predict(known, r, "known");
    r.revised_prediction = predict(revised, r, "revised");
    r.baseline_prediction = known && r.included ? known.intercept : null;
    r.future_revised_records = r.revised.filter(
      (v) => v !== null && v.available > r.decision,
    ).length;
  }
  const baseline = metrics(rows, "baseline_prediction"),
    scores = [
      {
        name: "Known-time ridge",
        ...metrics(rows, "known_prediction", baseline.mse),
      },
      {
        name: "Hindsight revisions",
        ...metrics(rows, "revised_prediction", baseline.mse),
      },
      {
        name: "Frozen mean",
        ...metrics(rows, "baseline_prediction", baseline.mse),
      },
    ],
    summary = {
      formation_included: rows.filter(
        (r) => r.included && r.partition === "formation",
      ).length,
      test_included: rows.filter((r) => r.included && r.partition === "test")
        .length,
      excluded: rows.filter((r) => !r.included).length,
      known_future_records: sum(
        rows.map(
          (r) =>
            r.known.filter((v) => v !== null && v.available > r.decision)
              .length,
        ),
      ),
      revised_future_records: sum(rows.map((r) => r.future_revised_records)),
      record_count: records.length,
    };
  return {
    settings: c,
    name: WORLDS[c.scenario][0],
    description: WORLDS[c.scenario][1],
    records,
    rows,
    known_fit: known,
    revised_fit: revised,
    scores,
    summary,
  };
}
