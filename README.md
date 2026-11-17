# Vintalane

An original synthetic alternative-data pipeline with two information clocks: when an activity observation happened, and when a version became available. Compare a known-time join with a deliberately invalid final-revision hindsight lens, then inspect formation-only ridge fits, frozen chronological tests and every selected source record.

**All proxies, publication records and outcomes are invented. No person, company, device, location trace, vendor feed, market data, real return, order or money is represented.** This is a mechanism audit for an alternative-data alpha pipeline, not discovered alpha, an investable strategy or evidence of expected profit.

## Run

Python 3.10+ standard library, no runtime dependencies:

```sh
python3 -m vintalane --scenario 0 --delay 0 > pipeline.json
python3 -m vintalane --scenario 2 --delay 1 > reversal.json
make test
```

```python
from vintalane import analyze, settings
config = settings()
config["delay"] = 1
result = analyze(config)
print(result["summary"], result["scores"])
```

Browser, no build step:

```sh
python3 -m http.server 8000 --directory docs --bind 127.0.0.1
```

Open `http://127.0.0.1:8000`. Bounded selectors apply immediately. Selecting a decision day changes only its source audit, not fits or predictions. Reset restores the default world, delay and decision 140. Full JSON export contains every publication record, all 200 decision joins/exclusions/targets/predictions, formation row IDs, frozen means/scales/slopes and score summaries. It downloads locally and is never sent elsewhere.

## The generated records

Integer days are an abstract ordered clock, not dates, market sessions, timezones or a claim about any vendor's release schedule. Generate 220 observation days, 0..219. Two sources are fictional aggregate activity proxies, named footfall and shipments. Each record carries ID, source, observation day, availability day, vintage and value. Availability means usable by the model at that clock in this experiment; a real pipeline also needs ingestion/access/entitlement evidence.

| Source          | First available | Revision available |
| --------------- | --------------: | -----------------: |
| Footfall proxy  | observation + 1 |    observation + 6 |
| Shipments proxy | observation + 3 |    observation + 8 |

The extra-delay control adds three days to **every availability day**, not the observation day, underlying value or target. Shipments observation days 80..95 and 175..190 are completely absent in both versions. There are 816 records in all. Revisions after day 219 remain in the export as future scheduled records; their presence does not make them eligible for earlier known-time decisions.

Hidden activity starts at zero and evolves as:

```text
a_t = 0.8 a_(t−1) + 0.9 U_t
b_t = 0.6 b_(t−1) + 0.3 a_t + 0.7 V_t
first-release proxy = its hidden activity + 0.5 × source noise
revised proxy = its hidden activity + 0.04 × a separate source noise
```

The two noises for each source are distinct draws, not a fitted denoiser. The revised proxy is designed to be a more precise view of the same hidden activity, not a real revision process. These proxy levels are dimensionless activity units, not actual customer counts, shipping volumes or private data.

Three outcome worlds:

- **Engineered relationship:** the day-t decision's next-day target is `0.012 a_t − 0.008 b_t + 0.014 W_t`. Activity and outcomes share components by construction.
- **Independent outcome:** the target is `0.014 W_t` only, from a separate pseudo-random stream. A favorable finite-sample score is not an inferred relationship or significance test.
- **Later reversal:** exactly the engineered formation outcomes, but the activity component changes sign for decision t ≥ 140. No scaling or model is refitted on this change.

These are arbitrary numeric outcome units, not an actual security's return. No annualization, wealth curve, PnL, transaction cost, portfolio position, allocation or trade execution is modeled.

## The join contract

For each decision t and each required source, the known-time lens requires:

```text
observation <= t
available <= t
0 <= t − observation <= 8
```

Among eligible records, choose greatest observation day, then greatest availability day, then greatest ID. Equality at release and age eight is eligible. This deliberately prioritizes a fresher observation over a later revision of an older observation. A revision of the latest eligible observation can be selected once it is available.

The hindsight lens keeps the observation and eight-day age tests but **drops the availability test**. Thus it generally sees the final revised value for a contemporaneous observation that had not been released at the decision. It is explicitly invalid as a deployable information set, not an oracle of future outcomes or a fair competing strategy. It need not produce better test errors, especially after a relationship reversal.

A required source without an eligible record is missing, not zero. No forward-looking backfill, interpolation, last-value carry beyond eight days or imputation occurs. Exclude that decision from **both lenses and the baseline** unless all four source selections are present. The common complete-row cohort makes score comparisons row-aligned; it does not remove selection bias. Added delay changes the cohort, so differences across delay settings reflect both older information and different included rows. The interface preserves every excluded row and its reason.

The unavailable-value counter for the known-time lens must be zero. The hindsight future-release count counts selected records with availability > decision across **all 200 decisions**, including otherwise excluded rows, and is not a unique-record count.

## Fit and label clocks

Use decisions 20..139 as formation candidates and 140..219 as test candidates. A decision at t predicts its label at t+1, which becomes available at t+1. Fit clock is 140. Thus the last formation target, from decision 139, is available at 140; the first test target, from decision 140, is not available until 141. Within this abstract clock, all observations and labels stamped 140 are available before fitting and predicting at 140; no finer intraday ordering is claimed.

For each lens separately, on the same included formation row IDs:

1. Fit each feature's mean and **population** standard deviation (denominator N). This scaling convention is not a sampling-uncertainty estimate.
2. Freeze those means and scales. A feature with formation variance ≤ 1e−24 gets scale 1 and an explicit constant-feature flag; an exactly constant feature then standardizes to zero.
3. Center target by its formation mean, the unpenalized intercept. Fit two standardized slopes minimizing:

```text
sum_i (y_i − mean_y − z_i · beta)^2 + 8 × sum_j beta_j^2
```

4. Solve the original centered 2×2 normal equations with 8 added to the diagonal. This is a sum-of-squares penalty, **not** a mean-squared-loss penalty of eight or an intercept penalty.
5. Freeze everything. Both formation diagnostics and test predictions use those exact coefficients and transforms. A fit with fewer than three included, label-eligible formation rows is undefined; predictions and scores remain undefined rather than fabricating a model.

The fixed λ = 8 is a declared choice, not cross-validated, optimized or selected on test errors. The labels, test outcomes and post-fit available records do not update the known-time fit. The hindsight fit intentionally uses historically unavailable versions and is not point-in-time valid even if its labels have valid timestamps. A correct scaler cannot repair its bad information set.

## Scores and baseline

All scores use common complete **test** decision rows only. A frozen-mean baseline predicts the formation target mean on those same rows. Show RMSE, MAE and:

```text
MSE skill = 1 − model test MSE / frozen-mean baseline test MSE
```

Zero skill matches this baseline, negative is worse, positive is lower MSE. This is not ordinary test-mean-centered R², rank IC, a probability, p-value or a significance test. If there are no usable test rows, metrics are undefined. Skill is undefined if baseline MSE ≤ 1e−24. Counts and exclusions are shown. Line charts break at excluded decisions; they do not interpolate predictions through missing inputs.

Prediction quality on an engineered toy does not establish economic value, causal effects or real alpha. No multiple-seed robustness study or confidence interval is claimed. Changing the world/delay after seeing results is descriptive exploration, not untouched external validation. In particular, good data-clock hygiene is necessary but far from sufficient for a useful strategy.

## Determinism and API

Both streams use the original LCG `(1664525*s + 1013904223) mod 2^32`, mapped to `s/2^31 − 1` in [−1, 1). Activity/source seed is 41813; outcome-noise seed is 77417. Each observation consumes six source-stream draws: A innovation, B innovation, two first-release noises, two revision noises. The outcome stream consumes one draw per observation. Missing shipment records do not shift either stream. This is fixed deterministic pseudo-randomness, not cryptographic randomness or a mathematical independence proof.

`analyze(config)` accepts exactly `scenario` (built-in integer 0..2) and `delay` (built-in integer 0..1). Python requires a built-in dict and rejects bools, floats, missing/extra keys; omitted config or `None` gives defaults. JavaScript accepts a plain object; omitted/undefined gives defaults, null is rejected. Calls return independent experiment objects and do not mutate input config. Selected lineage records refer to the corresponding generated records within an experiment; results are caller-owned mutable objects, not immutable snapshots. Internal helpers assume fixed finite generated inputs, not arbitrary untrusted arrays, proxies, custom subclasses, uploaded data or a production feature store.

## Verification

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm test
npm run test:browser
```

Runtime has no dependencies; pinned Playwright 1.56.1 is development-only. Native checks independently enumerate all source selections for every decision in both delay settings, release/age equality and tie priority, all frozen normal-equation residuals, score arithmetic, missing/constant/empty controls, future-record and later-label contamination, stable/reversal formation identity and strict CLI inputs. A development-only NumPy augmented least-squares oracle independently verified all 12 fits with an unpenalized intercept; it is not a runtime or native-test dependency. Python/JavaScript parity compares every field of all six complete experiments. Browser tests compare all displayed record/decision/score/fit cells, source-card provenance at complete/missing/boundary days, navigation, reset, full export, invalid retention and privacy at five widths. Shared bugs can survive parity; tests do not establish vendor-clock or market validity.

CI runs Python 3.10/3.12/3.13, Node 22, SHA-pinned Actions, checksum-verified Gitleaks and pinned Semgrep with explicit DOM/eval/network/native-effect checks. No visitor uploads, accounts, cookies, local storage, service worker, telemetry or runtime network requests. All five site assets, styles and SVG are original and same-origin, with no external fonts. Meta CSP restricts scripts/styles/images to self and denies connections, objects, base URLs and forms. Host logs/headers/framing/caching and browser history/downloads/session restore are outside app control. Reset is not secure erasure; scanners are not a security certification.

Native labels/controls/details, a skip link, visible keyboard focus, source lineage text, numeric tables, labelled noninteractive canvas and reduced motion are included. Wide tables scroll locally. No assistive-technology or cross-browser certification is claimed.

## Sources, rights and real-data limits

Original implementation, generated values, styles and SVG. No external data, code, model, table or site assets copied. The fictitious proxy names do not imply access to private activity or vendor feeds. A real application would need lawful sourcing, informed privacy controls, resale/analysis rights, entity mapping, representative coverage, consistent collection, release/ingestion evidence and changing-vendor checks. Do not treat an old observation date as permission or proof of historical availability.

- [Feast point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins): event-time TTL and current optional `filter_by_created_timestamp=True` for availability. A created timestamp must actually reflect usable availability. No Feast dependency is used.
- [Feast issue 6615](https://github.com/feast-dev/feast/issues/6615): historical discussion of backfilled-value leakage. Current official documentation, not the older issue's missing-feature description, governs claims about current Feast behavior.
- [ALFRED download help](https://alfred.stlouisfed.org/help/downloaddata): vintages as data that existed at a past date. No Fed data or API used.
- [FRED versus ALFRED](https://fred.stlouisfed.org/docs/api/fred/fred_vs_alfred.html): latest revised past versus historically known past.
- [Scikit-learn Ridge](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Ridge.html): sum-squared-loss plus L2 penalty convention. Implementation is original, without a scikit-learn runtime.
- [Scikit-learn common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html): training-only preprocessing and split-before-fit boundaries.
- [Deloitte alternative-data research](https://www.deloitte.com/us/en/insights/industry/financial-services/alternative-data-for-investors-from-discovery-to-institutionalization.html): lineage, quality, representativeness, ethics, privacy and rights risks.

MIT © 2026 Aditya Kulkarni.
