import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { analyze, settings } from "../docs/core.js";
let assertions = 0;
const check = (v, m) => {
  assertions++;
  assert(v, m);
};
function compare(a, b, path = "") {
  if (typeof a === "number") {
    check(Number.isFinite(a) && Number.isFinite(b), path + " finite");
    check(
      Math.abs(a - b) < 2e-13 + Math.abs(a) * 3e-11,
      `${path}: ${a} != ${b}`,
    );
  } else if (a === null || typeof a !== "object") check(a === b, path);
  else {
    check(
      JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b)),
      path + " keys",
    );
    for (const k of Object.keys(a)) compare(a[k], b[k], path + "." + k);
  }
}
const configs = [];
for (const scenario of [0, 1, 2])
  for (const delay of [0, 1]) configs.push({ scenario, delay });
const run = spawnSync(
  "python3",
  [
    "-c",
    "import json,sys;from vintalane.core import analyze;print(json.dumps([analyze(c)for c in json.load(sys.stdin)],allow_nan=False))",
  ],
  {
    input: JSON.stringify(configs),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  },
);
assert.equal(run.status, 0, run.stderr);
const expected = JSON.parse(run.stdout);
configs.forEach((c, i) => compare(analyze(c), expected[i], "full" + i));
for (const delay of [0, 1]) {
  const a = analyze({ scenario: 0, delay }),
    b = analyze({ scenario: 2, delay });
  compare(a.known_fit, b.known_fit);
  compare(a.revised_fit, b.revised_fit);
  compare(a.rows.slice(0, 120), b.rows.slice(0, 120));
}
for (const bad of [
  null,
  {},
  [],
  { scenario: 0, delay: true },
  { scenario: 3, delay: 0 },
  { scenario: 0, delay: 0, extra: 1 },
]) {
  assert.throws(() => analyze(bad));
  assertions++;
}
console.log(
  `${assertions} JS assertions; 6 complete Python states, frozen formation under later coefficient reversal PASS`,
);
