"""Synthetic alternative-data vintages, known-time joins and frozen ridge probes."""

import math
from copy import deepcopy

DEFAULT = {"scenario": 0, "delay": 0}
SOURCES = ("Footfall proxy", "Shipments proxy")
WORLDS = (
    (
        "An engineered relationship",
        "Future synthetic outcomes contain the same hidden activity components as the proxies. The relationship is put in by construction, not discovered alpha.",
    ),
    (
        "An independent outcome",
        "Outcome noise is generated separately from activity. Any finite-sample fit or score difference is not evidence of a real predictive relationship.",
    ),
    (
        "A later coefficient reversal",
        "Formation outcomes exactly match the engineered world. The relationship reverses in the test period; no model is refitted.",
    ),
)
LAMBDA = 8.0
TTL = 8
FIT_CLOCK = 140


class Random:
    def __init__(self, seed):
        self.state = seed

    def draw(self):
        self.state = (1664525 * self.state + 1013904223) % 2**32
        return self.state / 2**31 - 1


def settings():
    return deepcopy(DEFAULT)


def validate(c):
    if type(c) is not dict or set(c) != set(DEFAULT):
        raise ValueError("settings require exactly scenario and delay")
    for key, upper in (("scenario", 2), ("delay", 1)):
        if type(c[key]) is not int or not 0 <= c[key] <= upper:
            raise ValueError(f"{key} must be a built-in integer in 0..{upper}")


def generate(scenario, delay):
    rng, outcome_rng = Random(41813), Random(77417)
    records, outcomes = [], []
    a, b = 0.0, 0.0
    for day in range(220):
        a = 0.8 * a + 0.9 * rng.draw()
        b = 0.6 * b + 0.3 * a + 0.7 * rng.draw()
        draws = [rng.draw() for _ in range(4)]
        noise = 0.014 * outcome_rng.draw()
        signal = 0.012 * a - 0.008 * b
        if scenario == 1:
            target = noise
        else:
            target = (-signal if scenario == 2 and day >= 140 else signal) + noise
        outcomes.append({"decision": day, "label_available": day + 1, "target": target})
        for source in range(2):
            if source == 1 and (80 <= day <= 95 or 175 <= day <= 190):
                continue
            latent = a if source == 0 else b
            for vintage in range(2):
                value = latent + (
                    0.5 * draws[source] if vintage == 0 else 0.04 * draws[source + 2]
                )
                lag = ((1, 6), (3, 8))[source][vintage] + 3 * delay
                records.append(
                    {
                        "id": len(records) + 1,
                        "source": source,
                        "observation": day,
                        "available": day + lag,
                        "vintage": vintage,
                        "value": value,
                    }
                )
    return records, outcomes


def select(records, source, decision, hindsight=False):
    eligible = [
        r
        for r in records
        if r["source"] == source
        and 0 <= decision - r["observation"] <= TTL
        and (hindsight or r["available"] <= decision)
    ]
    return (
        max(eligible, key=lambda r: (r["observation"], r["available"], r["id"]))
        if eligible
        else None
    )


def assemble(records, outcomes):
    rows = []
    for outcome in outcomes[20:220]:
        day = outcome["decision"]
        known = [select(records, s, day) for s in range(2)]
        revised = [select(records, s, day, True) for s in range(2)]
        complete = all(r is not None for r in known + revised)
        rows.append(
            {
                **outcome,
                "partition": "formation" if day < FIT_CLOCK else "test",
                "known": known,
                "revised": revised,
                "included": complete,
                "exclusion": (
                    ""
                    if complete
                    else "A required proxy has no eligible observation within 8 days."
                ),
            }
        )
    return rows


def fit(rows, lens):
    usable = [
        r
        for r in rows
        if r["included"]
        and r["partition"] == "formation"
        and r["label_available"] <= FIT_CLOCK
    ]
    if len(usable) < 3:
        return None
    x = [[v["value"] for v in r[lens]] for r in usable]
    y = [r["target"] for r in usable]
    n = len(x)
    means = [sum(row[j] for row in x) / n for j in range(2)]
    variances = [sum((row[j] - means[j]) ** 2 for row in x) / n for j in range(2)]
    scales = [math.sqrt(v) if v > 1e-24 else 1.0 for v in variances]
    z = [[(row[j] - means[j]) / scales[j] for j in range(2)] for row in x]
    mean_y = sum(y) / n
    s00 = sum(v[0] ** 2 for v in z) + LAMBDA
    s11 = sum(v[1] ** 2 for v in z) + LAMBDA
    s01 = sum(v[0] * v[1] for v in z)
    rhs = [sum(v[j] * (target - mean_y) for v, target in zip(z, y)) for j in range(2)]
    det = s00 * s11 - s01 * s01
    beta = [(rhs[0] * s11 - rhs[1] * s01) / det, (rhs[1] * s00 - rhs[0] * s01) / det]
    return {
        "lens": lens,
        "count": n,
        "row_ids": [r["decision"] for r in usable],
        "means": means,
        "scales": scales,
        "constant_features": [v <= 1e-24 for v in variances],
        "intercept": mean_y,
        "beta": beta,
        "gram": [[s00, s01], [s01, s11]],
        "rhs": rhs,
        "lambda": LAMBDA,
        "fit_clock": FIT_CLOCK,
    }


def predict(model, row, lens):
    if model is None or not row["included"]:
        return None
    return model["intercept"] + sum(
        model["beta"][j]
        * (row[lens][j]["value"] - model["means"][j])
        / model["scales"][j]
        for j in range(2)
    )


def metrics(rows, field, baseline_mse=None):
    usable = [
        r
        for r in rows
        if r["included"] and r["partition"] == "test" and r[field] is not None
    ]
    if not usable:
        return {"count": 0, "mse": None, "rmse": None, "mae": None, "skill": None}
    errors = [r[field] - r["target"] for r in usable]
    mse = sum(e * e for e in errors) / len(errors)
    return {
        "count": len(errors),
        "mse": mse,
        "rmse": math.sqrt(mse),
        "mae": sum(abs(e) for e in errors) / len(errors),
        "skill": (
            1 - mse / baseline_mse
            if baseline_mse is not None and baseline_mse > 1e-24
            else None
        ),
    }


def analyze(value=None):
    c = settings() if value is None else value
    validate(c)
    c = deepcopy(c)
    records, outcomes = generate(c["scenario"], c["delay"])
    rows = assemble(records, outcomes)
    known, revised = fit(rows, "known"), fit(rows, "revised")
    for row in rows:
        row["known_prediction"] = predict(known, row, "known")
        row["revised_prediction"] = predict(revised, row, "revised")
        row["baseline_prediction"] = (
            known["intercept"] if known and row["included"] else None
        )
        row["future_revised_records"] = sum(
            r is not None and r["available"] > row["decision"] for r in row["revised"]
        )
    baseline = metrics(rows, "baseline_prediction")
    scores = [
        {
            "name": "Known-time ridge",
            **metrics(rows, "known_prediction", baseline["mse"]),
        },
        {
            "name": "Hindsight revisions",
            **metrics(rows, "revised_prediction", baseline["mse"]),
        },
        {
            "name": "Frozen mean",
            **metrics(rows, "baseline_prediction", baseline["mse"]),
        },
    ]
    summary = {
        "formation_included": sum(
            r["included"] and r["partition"] == "formation" for r in rows
        ),
        "test_included": sum(r["included"] and r["partition"] == "test" for r in rows),
        "excluded": sum(not r["included"] for r in rows),
        "known_future_records": sum(
            v is not None and v["available"] > r["decision"]
            for r in rows
            for v in r["known"]
        ),
        "revised_future_records": sum(r["future_revised_records"] for r in rows),
        "record_count": len(records),
    }
    return {
        "settings": c,
        "name": WORLDS[c["scenario"]][0],
        "description": WORLDS[c["scenario"]][1],
        "records": records,
        "rows": rows,
        "known_fit": known,
        "revised_fit": revised,
        "scores": scores,
        "summary": summary,
    }
