# CI standard

Applies across all phases, adopted 2026-10-15. CI is an acceptance gate for the
source being proposed, rather than a best-effort build indicator. A green older
commit, a skipped platform or a successful compile does not establish current
runtime acceptance. Preserve the real crypto, permission and storage checks.

## Workflow requirements

- Every PR, main push, merge-group run and manual dispatch runs the required
  checks. Avoid path filters that can silently omit required coverage.
- The **CI required** job runs after every required job and succeeds only if
  all succeeded. Failure, cancellation, skipped jobs and missing results fail
  the gate. Both desktop and browser matrices must finish successfully.
- Tests fail the workflow on failure; do not introduce `continue-on-error`,
  `|| true`, blanket skips or success-only placeholder results to obtain green CI.
  A narrowly documented platform capability result is permitted only for an
  intentionally unsupported feature; it cannot waive a supported product gate.
- Each distinct native acceptance command gets its own step. In particular,
  a later successful PowerShell command must not hide an earlier failed command.
- All jobs have bounded timeouts. Missing required evidence fails artifact upload.
  Upload diagnostic reports on failure, use short retention and keep credentials,
  message contents, invite capabilities and operator secrets out of artifacts.
- Workflow syntax, expressions and embedded shell are validated with pinned,
  checksum-verified actionlint. CI requires ShellCheck to be present. The required
  gate itself has tests for unsuccessful, missing and malformed job results.
  A policy check enforces the full job inventory, SHA pins, token permissions,
  timeouts and artifact requirements so these rules cannot drift silently.
- Remote actions use full commit SHAs, with readable version comments and weekly
  Dependabot update PRs. Updates receive normal review and required checks.
  Tokens default to `contents: read`; checkout does not persist credentials.
  Grant extra permissions only to the specific job that needs them. Do not expose
  secrets or write tokens to untrusted PR code.

The current required job IDs are `workflow-policy`, `rust`, `crypto-wasm`, `auth`,
`web`, `desktop`, `media-browser`, `compose` and `podman`. When adding a required
job, update both `required-gate.needs` in the workflow and the shared inventory in
`.github/required-ci-jobs.json`. The policy check requires every test job to feed
the gate, and the gate's failure tests cover each inventoried job.

## Coverage required as features change

- Rust formatting, Clippy warnings, tests and protocol-generation drift checks.
- TypeScript checking, lint, tests, production web build and real product WASM.
- Actual PostgreSQL migrations and HTTP/gateway permission acceptance, including
  unauthenticated, wrong-account, wrong-device, stale-proof and replay rejection.
- Private S3 access, ciphertext cleanup, upload races/restart and encrypted file
  round trips. New upload limits need exact-boundary and over-limit checks.
- Real packaged Windows/macOS/Linux runtime, native credential storage, SQLCipher
  and fixture cleanup. Build-only or harness-only evidence does not establish that
  the installer works; extend installed-product acceptance as packaging develops.
- Browser checks for the current supported engines, plus two-client member/role
  changes, profile verification, modal focus and narrow layout for the new UI.
- Add dependency-vulnerability and static security checks with reviewed policies
  before Phase 3 closeout. Triage findings; any exception needs a specific owner,
  rationale, expiry and mitigation. Do not turn off a category to bypass a finding.

Automated coverage must grow with each implementation step, rather than being
postponed until the final build. Actual push-provider/OS delivery, clean-machine
installation and two-house testing remain explicit human acceptance where they
cannot be automated reliably; CI must not claim those passed from mocks.

## Hosted enforcement and remaining rollout

On 2026-10-15, the API reported that `main` was not branch-protected. The latest
visible hosted attempts were older Phase 3 runs ending in `startup_failure` before
jobs started. Local linting does not resolve or validate hosted execution.

1. Push/review these workflow changes and get a real run on the proposed source.
2. Diagnose any recurring startup failure without relaxing required coverage.
3. Configure a repository ruleset/branch protection to require **CI required**
   from GitHub Actions on `main`, require checks against the current base or a
   merge queue, require PR review, and restrict bypasses/direct pushes.
4. Verify a failed or skipped required job prevents merging. Do not substitute
   an older successful run or a check from another integration.

Workflow files alone cannot enable repository branch protection. Until that
rollout is done, these local changes are not enforced on hosted merges.

Local workflow checks:

```sh
node scripts/verify-workflows.mjs
node --test scripts/test/verify-ci-results.test.mjs
python3 scripts/verify-workflow-policy.py # requires PyYAML, installed by the CI job
```

The validator supports Windows, Linux and macOS on x64/ARM64. It downloads the
official actionlint v1.7.12 archive and checks its committed SHA-256 before use.
On machines without ShellCheck, actionlint's embedded shell checks are unavailable;
the hosted policy job explicitly requires it.

References: [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[status check behavior](https://docs.github.com/en/pull-requests/reference/status-checks),
and [actionlint](https://github.com/rhysd/actionlint).
