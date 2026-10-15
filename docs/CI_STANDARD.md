# Actions budget standard

Applies across all phases, updated 2026-10-15. The priority is minimizing GitHub
Actions minutes and storage. This replaces the earlier interpretation that every
push/PR should run the complete hosted acceptance matrix.

## Local first, hosted runs only on request

Run appropriate checks locally during normal development. Do not dispatch a
hosted workflow without the user's explicit request to run hosted CI. Permission
to edit code, commit, push or prepare a package does not by itself authorize a
hosted run. No hosted workflow was dispatched while configuring this policy.

The CI workflow uses **workflow_dispatch only**: no push, pull-request, merge-group,
tag or scheduled runs. Ordinary development and documentation edits therefore do
not start this workflow. Do not reintroduce automatic triggers without discussing
the Actions budget first. Do not retry a startup/billing failure in a loop.

## Explicit run tiers

| Selected suite | Hosted work | When to use |
| --- | --- | --- |
| `checks` (default) | One Linux job: workflow lint, budget-policy validation and suite-result tests. No Rust/WASM/app builds. | Deliberately checking CI configuration. These checks can also run locally. |
| `core` | Linux Rust, crypto/WASM, web, real PostgreSQL/private-S3 and Docker/Podman checks, plus the selected-suite result gate. | An explicitly requested integration checkpoint after local checks pass. |
| `full` | Core plus Windows/macOS/Linux desktop and Chrome/Firefox/Safari acceptance. | An explicitly requested phase/release milestone after features stabilize. |

The expanded workflow has one job in `checks`, eight jobs in `core`, and fourteen
in `full`, counting matrix entries and the result gate. These are job counts,
not measured runtimes or a spending guarantee. Only `full` establishes current
cross-platform acceptance. `checks` and `core` must never be labeled as full passes.

## Avoid waste within a requested run

- Use standard Linux runners for the lightweight and core suites. Start expensive
  platform matrices only after all Linux core jobs succeed.
- Cancel superseded runs on the same ref. Fail fast within desktop/browser matrices;
  a cancelled supported platform remains unvalidated until a later requested run.
- Reuse npm/Rust caches and the product-WASM artifact within full acceptance.
  Avoid duplicate dependency installation when validation tools are already present.
- Run the Linux packaged acceptance once, rather than repeating it ten times.
  Additional repetitions belong in targeted local investigation, or a separately
  authorized hosted investigation when a real regression warrants it.
- Keep timeouts bounded. Fix failing checks locally before another hosted attempt.
- Retain uploaded artifacts for one day. Core success keeps job logs rather than
  uploading unused build/report artifacts; failed integration checks retain
  diagnostics. Full acceptance retains the reports and shared WASM it needs.
  Store durable milestone evidence locally/in source after sanitizing it.
- Group action-update PRs monthly, with one open update PR at a time.
- Keep read-only tokens and pinned action SHAs; these add no extra test matrix.

The policy checker rejects automatic triggers, a more expensive default tier,
unconditional expensive jobs, missing Linux prerequisites, disabled fail-fast and
longer artifact retention. Suite-result tests reject failure, cancellation,
missing results and skipped selected jobs. Only the explicitly unselected jobs
may be skipped, and a core result cannot masquerade as a full result.

## Acceptance and rollout

Maintain real crypto, authorization, encrypted storage and privacy checks locally
as features change. At a phase milestone, run the final-source full suite once on
explicit request, fix failures locally and rerun only when justified. Manual
clean-PC/two-house testing and actual notification delivery remain separate gates.

These workflow changes are local until pushed/merged. GitHub's manual-dispatch
workflow must be present on the default branch before its configured manual UI
is available. No hosted execution or measured savings are claimed here.
The earlier observed startup failures are not a reason to start additional runs.

Do not make the full suite a mandatory check on every merge under this budget
policy. Hosted branch protection and account billing settings were not changed.
For a monetary hard stop, use the account's Actions budget with **Stop usage when
budget limit is reached**, where available. Alerts alone do not cap spending.
The workflow cannot set or verify that account-wide cap; no paid amount is assumed.

Local validation (no GitHub-hosted minutes):

```sh
node scripts/verify-workflows.mjs
node --test scripts/test/verify-ci-results.test.mjs
python3 scripts/verify-workflow-policy.py # requires PyYAML
```

The validator uses checksum-pinned actionlint. Hosted lint requires ShellCheck;
local machines without it do not validate embedded shell scripts with ShellCheck.

References, checked 2026-10-15: [manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[hard budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets).
