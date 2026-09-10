# Provisional hosting assessment — 10 September 2026

Auto-SBC can run remotely, but the current release is a local private beta. It
must not be exposed publicly with its existing unauthenticated, single-user API.
No cloud deployment or club-data upload has been performed.

## Observed request measurements

Four fresh JSON files from the extension's **Export solve request** button were
measured sequentially in separate local processes. The script validates the
production request shape and runs the normal planner, catalog enrichment,
protection policy and solver. It preserves the exported requirements, formation,
per-card positions, policy and 30-second solve budget. Only anonymous aggregates
are reported; the request files remain local.

These measurements used macOS ARM64, Python 3.12.14 and eight solver workers.
Wall time covers planner execution, excluding imports, request validation,
preparing a temporary copy of the public catalog, HTTP transport and job polling.
Peak RSS includes the entire benchmark process. The public catalog contained
28,501 cards; all four requests disabled concepts. These are local pipeline
measurements, not complete hosted-service capacity tests.

| Captured case | Exported cards | Policy-retained model rows | Shape | Peak process memory | Planner wall time | Result |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| Bronze preview with the daily-equivalent policy | 1,682 | 1,346 | 1 player, 10 fixed empty slots, no chemistry | 173.1 MiB | 0.147 s | Optimal |
| Bronze single preview with the normal policy | 3,191 | 3,122 | 1 player, 10 fixed empty slots, no chemistry | 191.1 MiB | 0.201 s | Optimal |
| 91-rated squad, normal single preview | 3,191 | 3,122 | 11 players, no chemistry | 279.9 MiB | 6.876 s | Optimal |
| Pre-Season Challenge 6, normal single preview — original assignment model | 3,190 | 3,121 | 11 players, 31 chemistry, actual formation and alternative positions | 2,817.8 MiB | 30.386 s | Feasible; cheapest cost not proven |
| Same Pre-Season request — exact sparse assignment domains | 3,190 | 3,121 | Same candidates and requirements; impossible out-of-position assignments omitted | 2,046.7 MiB | 30.193 s | Feasible; cheapest cost not proven |

The primary daily measurement is the first row: maximum rating 64, maximum card
value 1,000, with special, played and evolved cards protected. It is a native
single preview configured with the daily policy, not a timing of an entire
automated daily cycle. The second Bronze export used the normal preview policy:
maximum rating 94, maximum card value 25,000 and special-card protection off.
The rating and chemistry previews used that same normal policy. Played and
evolution protections remained enabled in every case. The two Bronze results
must not be presented as measurements of the same settings.

Pre-Season Challenge 6 also required at least five players from one league, at
most six nations and four clubs, at least four cards from the rare group, and
81 team rating. Its actual formation was
`[0, 3, 5, 5, 5, 7, 10, 14, 14, 25, 25]`. The 3,121 model rows carried 6,576
listed position options; 30 rows were constrained out because their chemistry
profiles were unsupported. This was an observed request, not the all-flexible
synthetic stress case below.

The chemistry comparison records two implementation checkpoints, each using
eight workers and the same 30-second request budget.
For this 11-player, 31-chemistry model, one out-of-position player contributes
zero and leaves a maximum of 30; every selected player therefore needs a legal
position. An equivalent model using only those legal assignment choices is
implemented and passed 129 solver regressions, including equivalence against
the prior full assignment domains. A single repeat measured 2,046.7 MiB peak,
771.1 MiB lower, while preserving every candidate. The two runs do not establish
a deterministic memory or speed improvement. The historical 2,817.8 MiB peak
does not establish that all real chemistry SBCs need approximately 3 GB,
and does not independently settle whether Render is suitable. Daily and rating
results likewise do not prove that a full service fits its limits.

## Historical synthetic stress measurements

`scripts/benchmark_hosting.py` runs a synthetic pool in its own process without
reading an EA account. These runs supplied 3,000 candidates and a five-second
solve budget:

| Case | Peak process memory | Wall time | Result |
| --- | ---: | ---: | --- |
| Rating only | 156.1 MiB | 0.412 s | Optimal within the supplied pool |
| Rating plus 33 chemistry, all-flexible synthetic positions | 934.3 MiB | 4.845 s | Optimal within the supplied pool |

These are local macOS measurements, with the two processes run concurrently.
The 3,000-candidate, all-flexible-position chemistry case is a **stress test
only**. It does not represent an observed SBC request. Its result is not grounds
to rule out Render's 512 MB tier, nor does the rating-only result prove that a
complete hosted service fits. Neither run measures cloud performance or a
memory upper bound.

Keep these sizes separate:

- **Club inventory:** all cards read from Club and Storage before eligibility
  filtering. This is not the number of candidates required for every solve.
- **Exported pool:** cards passed by the extension's protections and filters.
  Exported requests do not establish the total pre-filter club inventory.
- **Policy-retained model rows:** normalized cards retained after backend
  protection and price checks, plus separately identified concept candidates.
  A retained row is not necessarily usable: challenge criteria, unavailable
  legal positions or unsupported metadata can force its selection variable to
  zero. Do not describe every row as a useful eligible choice, or infer that
  every raw club card needs a chemistry assignment domain.
- **Position model:** the challenge's usable slots, fixed empty slots, each
  candidate's legal position options and whether chemistry is required. Giving
  every synthetic candidate every position changes the model independently of
  inventory size.

The observed table provides initial daily, rating and chemistry measurements.
Optimized chemistry, constrained-CPU runs, HTTP service overhead and memory
retention across sequential jobs still need measurement. Host recommendations
remain provisional.

The benchmark requires an explicit source. Preserve the actual export; do not
replace its position options or change its policy to make a smaller benchmark.

```sh
.venv/bin/python scripts/benchmark_hosting.py --request /path/to/export.json --request-profile single-preview
.venv/bin/python scripts/benchmark_hosting.py --request /path/to/daily-policy-export.json --request-profile daily-preset
.venv/bin/python scripts/benchmark_hosting.py --synthetic --players 3000 --chemistry --seconds 5
```

`--request-profile` records the known capture context; it does not modify the
request. Generated cases require `--synthetic`, and `--players`, `--chemistry`
and `--seconds` cannot override an observed export. Observed mode uses a
temporary snapshot of the existing local public catalog and makes no network
requests. Its current cached prices may differ from prices at the original
capture time; expired live quotes remain expired.

## Practical benchmark matrix

Use the actual native requirements and filtered candidate pools from the
[real-world acceptance cases](REAL-WORLD-CASES.md). Observed account behavior
establishes useful cases; it does not establish their hosting cost or capacity.
Keep account payloads local and publish only aggregate measurements. A hosted
smoke test can use a structural replica with synthetic identities, clearly
labelled as such.

| Case | Representative input and boundary | Measurements and current evidence |
| --- | --- | --- |
| Daily Bronze | Observed one-player, ten-fixed-slot challenge shape; owned cards and the daily policy. Do not turn fixed empty slots into assignment candidates | Daily-equivalent preview measured at 173.1 MiB / 0.147 s above. Full-cycle service memory and lifecycle timing remain unmeasured |
| Daily Silver / Common Gold / Rare Gold | Fresh native requirements and owned eligible pool for each tier; unopened reward packs contribute no players | Successful solve or explicit shortage, time and memory. Silver completion and finite daily planning observed; representative tier measurements pending |
| 10x85+ rating part | Observed 84 rating, 11 players and required rarity-group card, with played, evolution and saved-squad protections | Imported inventory versus eligible candidates, solution status, time and memory. Native completion observed; representative hosting measurement pending |
| Multi-part player / pick set | Actual remaining 90/91-rated or other native parts, solved sequentially with updated ownership and rights | One actual 91-rated preview measured at 279.9 MiB / 6.876 s. Whole-sequence service capacity and memory retention remain unmeasured |
| A chemistry SBC | Actual native formation, target and per-card alternative positions; separate exported cards, policy-retained rows and forced-zero rows | Actual Pre-Season Challenge 6 measured above. Equivalent sparse position domains, worker limits and host measurements remain pending |
| Early FC 27 concepts | Matching-season eligible concept candidates and fresh quotes; preserve no-quote and stale-quote outcomes | Separate quote-fetch time from solver time and memory. FC 26 concept placement observed; FC 27 live flow and representative measurement pending |

For each run, record the workload shape above, hardware and runtime, allocated
CPU, solver worker count, solve budget, result status, wall time, CPU time, idle
service memory and peak service/process memory. Start with one server worker and
one solve at a time. Measure repeated sequential jobs before adding concurrency.
Retain the existing synthetic stress case as a separate robustness check; do not
substitute it for these workloads or estimate their memory from it.

Test service restart, sleep/wake and job-result retrieval separately from solver
capacity. The observed 521/409 recoveries and pending reload/rights-change cases
require preserved browser receipts and no automatic replay regardless of host
size.

## Options

| Host | Free offer and qualifications | Provisional assessment |
| --- | --- | --- |
| Render | 512 MB and 0.1 CPU; sleeps after 15 minutes; storage is ephemeral. Free use without a payment method is documented | Remains a candidate pending representative time and memory measurements; sleep and storage require lifecycle handling |
| Cloud Run | Monthly request-based allowances include 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests; a billing account is required and overages or adjacent services can cost money | Managed option after transport and access changes; capacity and cost require representative measurements |
| Oracle Always Free A1 | Current resource documentation gives 2 OCPU/12 GB and 200 GB combined boot/block storage for free tenancies; card verification and regional capacity are required | VM option subject to availability and maintenance; representative deployment testing still required |
| Hugging Face Spaces | CPU Basic lists 2 vCPU/16 GB without hourly charges, but creating a new Docker/Gradio compute Space now requires a paid plan | Does not meet a free new deployment requirement under the documented rules |

Sources: [Render plans](https://render.com/docs/compute-plans) and
[free-service limitations](https://render.com/docs/free);
[Cloud Run pricing](https://cloud.google.com/run/pricing) and
[billing requirements](https://docs.cloud.google.com/free/docs/free-cloud-features);
[Oracle's current free-resource allocation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
and [signup FAQ](https://www.oracle.com/cloud/free/faq/);
[current Spaces documentation](https://huggingface.co/docs/hub/en/spaces-overview).

Oracle can reclaim sufficiently idle instances, and free capacity can be
unavailable. Older marketing pages quote a larger A1 allocation; the specific
current resource documentation should govern a new tenancy. The pinned OR-Tools
release has Linux ARM64 wheels for Python 3.11/3.12, making A1 plausible at the
dependency level; an actual deployment still needs testing.
[OR-Tools publisher files](https://pypi.org/project/ortools/9.15.6755/#files)

## Architecture requirements before a hosted beta

These requirements apply independently of the outstanding capacity measurements.

1. Use an explicitly configured HTTPS origin in the backend, extension transport
   and manifest. Retain the local mode as an option. Do not grant access to
   arbitrary origins.
2. Authenticate API requests and bind every solve job/result to its user. Add
   per-user quotas and bounded concurrency. CORS is not authentication, and a
   shared key alone is not a multi-user product.
3. Disclose that hosted solving sends selected club-card data to that server.
   Keep credentials, market actions and SBC submission in the EA browser.
   Keep club payloads transient; exclude them from application/access logs.
4. Preserve public catalog snapshots separately from disposable compute.
   Schedule controlled updates and show source age/coverage to users.
5. Explicitly cap OR-Tools workers to allocated CPU. Run the representative
   benchmark matrix before choosing resources, starting with one server worker
   and one compute job at a time. Add larger synthetic stress pools separately.
6. For Cloud Run, replace the current detached Python thread with an active
   request/stream or a supported durable job system. In-memory polling jobs
   cannot safely scale across instances or rely on idle CPU. Chrome service
   worker fetches also have lifecycle limits; simply increasing a timeout does
   not solve this.

These constraints follow [Cloud Run's execution guidance](https://docs.cloud.google.com/run/docs/tips/general)
and [Chrome's extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

The next capacity check is to validate and remeasure the chemistry model change,
then test the captured workloads with the intended CPU/worker limits and service
lifecycle. Render remains under consideration; neither the synthetic stress case
nor the historical unoptimized chemistry result settles that choice. No provider
is selected by the current evidence.
