# Repository publication review

Reviewed 2026-10-16 before changing `KBHarris/hearth` from private to public.
This records the checks and their limits; a scanner cannot prove the absence of
every kind of private information.

- Fetched every remote branch and PR head (PRs 1–4). Scanned all 48 reachable
  commits with the checksum-verified official Gitleaks 8.30.1 binary, ignoring
  inline scanner suppression comments.
- Scanned a separate snapshot of all tracked and non-ignored source files.
  No environment files, S3 credentials, private-key containers, database dumps or
  local account databases were found in the 325 historical file paths.
- Reviewed the five history matches and four current-source matches. All are
  false positives: a source-file SHA-256 in the guided-setup evidence, the public
  authentication protocol profile string, public Cargo dependency names, and a
  synthetic Web Push fixture auth value. The fixture uses a deliberately fake
  provider endpoint and is not a subscription belonging to a person.
- Reviewed four PR descriptions. There are no issue comments or PR review
  comments; Discussions is disabled. No releases or release assets exist yet.
- Downloaded all 252 unexpired Actions artifacts (41,187,002 compressed bytes)
  and all 36 available run-log archives. Scanned their 1,342 extracted files
  (226,719,814 bytes); no Gitleaks matches. The seven remaining runs concluded
  `startup_failure` and GitHub returns 404 for their logs.
- Checked historical network references. The apparent public IPv4 matches are
  Chrome/Edge version strings in user-agent evidence, not personal host addresses.
  Remaining service references are local fixtures or documented example addresses.

Raw downloads, redacted scanner reports and audit snapshots stay under ignored
`target/public-audit/`; they are not published. The release private key lives in
ignored `.release-keys/`, with owner-only Windows permissions. Only its public key
is included in the desktop configuration. Back up the private key separately;
never attach it to a release or client/server bundle.

No history rewrite or credential rotation was indicated by these findings. Future
source and release artifacts still require a fresh scan. Making the repository
public does not validate application security or the pending Phase 3 human gates.

Follow-up source scan on 2026-10-16 (02:29 UTC on October 17) reviewed 297 source
files and the same 48 reachable commits. It found the same four current-source
false positives and no new matches. Private release keys and local tool/account
directories are explicitly excluded from the Docker build context as well as
from source and package staging. Final release assets require their own scan.
