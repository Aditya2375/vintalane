import math
from copy import deepcopy
import json
import subprocess
import sys
import unittest
from unittest.mock import patch
from vintalane.core import (
    analyze,
    settings,
    select,
    fit,
    generate,
    assemble,
    predict,
    metrics,
)


class Core(unittest.TestCase):
    def test_01_join_independent_every_row(self):
        for delay in [0, 1]:
            result = analyze({"scenario": 0, "delay": delay})
            for r in result["rows"]:
                for lens in ["known", "revised"]:
                    for source in [0, 1]:
                        candidates = []
                        for rec in result["records"]:
                            if rec["source"] != source:
                                continue
                            if (
                                rec["observation"] > r["decision"]
                                or rec["observation"] < r["decision"] - 8
                            ):
                                continue
                            if lens == "known" and rec["available"] > r["decision"]:
                                continue
                            candidates.append(rec)
                        candidates.sort(
                            key=lambda x: (-x["observation"], -x["available"], -x["id"])
                        )
                        self.assertEqual(
                            r[lens][source], candidates[0] if candidates else None
                        )
                self.assertEqual(
                    r["included"], all(v is not None for v in r["known"] + r["revised"])
                )
            self.assertEqual(result["summary"]["known_future_records"], 0)
            self.assertEqual(result["summary"]["record_count"], 816)

    def test_02_boundary_clock_and_priority(self):
        recs = [
            {
                "id": 1,
                "source": 0,
                "observation": 2,
                "available": 10,
                "vintage": 0,
                "value": 1.0,
            },
            {
                "id": 2,
                "source": 0,
                "observation": 2,
                "available": 11,
                "vintage": 1,
                "value": 2.0,
            },
            {
                "id": 3,
                "source": 0,
                "observation": 4,
                "available": 12,
                "vintage": 0,
                "value": 3.0,
            },
        ]
        self.assertEqual(select(recs, 0, 10), recs[0])
        self.assertIsNone(select(recs, 0, 9))
        self.assertEqual(select(recs, 0, 10, True), recs[2])
        self.assertIsNone(
            select(recs, 0, 11)
        )  # observation2stale9; observation3notyetavailable
        self.assertEqual(select(recs, 0, 12), recs[2])
        tie = [dict(recs[0]), dict(recs[0])]
        tie[1]["id"] = 7
        self.assertEqual(select(tie, 0, 10)["id"], 7)

    def test_03_full_normal_equations_and_metrics(self):
        for scenario in [0, 1, 2]:
            for delay in [0, 1]:
                r = analyze({"scenario": scenario, "delay": delay})
                for lens in ["known", "revised"]:
                    m = r[lens + "_fit"]
                    train = [
                        v
                        for v in r["rows"]
                        if v["included"] and v["partition"] == "formation"
                    ]
                    self.assertEqual(m["count"], len(train))
                    self.assertLessEqual(max(v["label_available"] for v in train), 140)
                    errors = []
                    z = []
                    for row in train:
                        zz = [
                            (row[lens][j]["value"] - m["means"][j]) / m["scales"][j]
                            for j in [0, 1]
                        ]
                        z.append(zz)
                        errors.append(predict(m, row, lens) - row["target"])
                    self.assertAlmostEqual(sum(errors), 0, places=12)
                    for j in [0, 1]:
                        self.assertAlmostEqual(sum(v[j] for v in z), 0, places=11)
                        self.assertAlmostEqual(
                            sum(v[j] ** 2 for v in z), len(train), places=10
                        )
                        self.assertAlmostEqual(
                            sum(zz[j] * e for zz, e in zip(z, errors))
                            + 8 * m["beta"][j],
                            0,
                            places=11,
                        )
                test = [
                    v for v in r["rows"] if v["included"] and v["partition"] == "test"
                ]
                base = sum(
                    (v["target"] - r["known_fit"]["intercept"]) ** 2 for v in test
                ) / len(test)
                for score, key in zip(
                    r["scores"],
                    ["known_prediction", "revised_prediction", "baseline_prediction"],
                ):
                    mse = sum((v[key] - v["target"]) ** 2 for v in test) / len(test)
                    self.assertAlmostEqual(score["mse"], mse, places=16)
                    self.assertAlmostEqual(score["rmse"] ** 2, mse, places=16)
                    self.assertAlmostEqual(score["skill"], 1 - mse / base, places=12)

    def test_04_future_revisions_and_targets_never_train(self):
        records, outcomes = generate(0, 0)
        base = fit(assemble(records, outcomes), "known")
        for r in records:
            if r["available"] > 140:
                r["value"] += 999
        for r in outcomes:
            if r["label_available"] > 140:
                r["target"] -= 999
        changed = fit(assemble(records, outcomes), "known")
        self.assertEqual(base, changed)
        for delay in [0, 1]:
            a = analyze({"scenario": 0, "delay": delay})
            b = analyze({"scenario": 2, "delay": delay})
            self.assertEqual(a["known_fit"], b["known_fit"])
            self.assertEqual(a["revised_fit"], b["revised_fit"])
            self.assertEqual(a["rows"][:120], b["rows"][:120])
        # A late revision can change the hindsight join, but not the known-time row.
        records, outcomes = generate(0, 0)
        before = deepcopy(assemble(records, outcomes)[0])
        for r in records:
            if r["available"] > 20:
                r["value"] += 1000
        after = assemble(records, outcomes)[0]
        self.assertEqual(before["known"], after["known"])
        self.assertNotEqual(before["revised"], after["revised"])

    def test_05_missing_and_constant_feature(self):
        r = analyze()
        self.assertEqual(r["summary"]["excluded"], 22)
        for row in r["rows"]:
            if not row["included"]:
                self.assertIsNone(row["known_prediction"])
                self.assertIsNone(row["revised_prediction"])
                self.assertIsNone(row["baseline_prediction"])
                self.assertTrue(row["exclusion"])
        records, outcomes = generate(0, 0)
        for row in records:
            row["value"] = 2.0
        m = fit(assemble(records, outcomes), "known")
        self.assertEqual(m["constant_features"], [True, True])
        self.assertEqual(m["beta"], [0.0, 0.0])
        self.assertEqual(m["scales"], [1.0, 1.0])
        with patch("vintalane.core.generate", return_value=([], outcomes)):
            empty = analyze()
            self.assertIsNone(empty["known_fit"])
            self.assertIsNone(empty["revised_fit"])
            self.assertTrue(
                all(v["count"] == 0 and v["rmse"] is None for v in empty["scores"])
            )
        self.assertIsNone(metrics([], "a")["skill"])

    def test_06_controls_and_release_lag(self):
        a = analyze()
        d = analyze({"scenario": 0, "delay": 1})
        self.assertGreater(d["summary"]["excluded"], a["summary"]["excluded"])
        for r, s in zip(a["records"], d["records"]):
            self.assertEqual(r["value"], s["value"])
            self.assertEqual(s["available"], r["available"] + 3)
        self.assertEqual(
            [v["target"] for v in a["rows"]], [v["target"] for v in d["rows"]]
        )
        self.assertLess(a["scores"][1]["rmse"], a["scores"][0]["rmse"])
        self.assertGreater(a["summary"]["revised_future_records"], 0)
        flipped = analyze({"scenario": 2, "delay": 0})
        self.assertLess(flipped["scores"][1]["skill"], 0)

    def test_07_strict_cli_detached(self):
        for bad in [
            {},
            [],
            False,
            {"scenario": False, "delay": 0},
            {"scenario": 3, "delay": 0},
            {"scenario": 0, "delay": 0, "x": 1},
        ]:
            with self.assertRaises(ValueError):
                analyze(bad)
        c = settings()
        r = analyze(c)
        r["settings"]["delay"] = 1
        self.assertEqual(c, settings())
        p = subprocess.run(
            [sys.executable, "-m", "vintalane", "--scenario", "1", "--delay", "1"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(json.loads(p.stdout)["settings"], {"scenario": 1, "delay": 1})
        p = subprocess.run(
            [sys.executable, "-m", "vintalane", "--delay", "2"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(p.returncode, 2)


if __name__ == "__main__":
    unittest.main()
