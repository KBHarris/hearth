"""Enforce CI guardrails after actionlint validates the workflow syntax."""
import json
import re
from pathlib import Path

import yaml

if not __debug__:
    raise RuntimeError("Workflow policy must run with assertions enabled")

root = Path(__file__).resolve().parent.parent
with (root / ".github/workflows/ci.yml").open(encoding="utf-8") as handle:
    workflow = yaml.load(handle, Loader=yaml.BaseLoader)
required = json.loads((root / ".github/required-ci-jobs.json").read_text(encoding="utf-8"))
jobs = workflow["jobs"]
assert len(required) == len(set(required)), "Duplicate required jobs"
assert set(required) == set(jobs) - {"required-gate"}, "Every test job must feed the gate"
gate = jobs["required-gate"]
assert set(gate["needs"]) == set(required), "Gate dependencies must match the required job inventory"
assert gate["name"] == "CI required", "Preserve the required check name"
assert gate["if"].replace(" ", "") == "${{always()}}", "Gate must run after failed or skipped dependencies"
assert workflow["permissions"] == {"contents": "read"}, "CI token must be read-only"
assert set(workflow["on"]) == {"pull_request", "push", "merge_group", "workflow_dispatch"}, "Unexpected or missing trigger"
for job_id, job in jobs.items():
    assert 0 < int(job["timeout-minutes"]) <= 120, job_id
    assert "continue-on-error" not in job, job_id
    assert "permissions" not in job or job["permissions"] == {"contents": "read"}, job_id
    assert job_id == "required-gate" or "if" not in job, "Required jobs cannot be conditionally skipped"
    for step in job["steps"]:
        assert "continue-on-error" not in step, job_id
        if "uses" in step:
            assert re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", step["uses"]), step["uses"]
        if step.get("uses", "").startswith("actions/checkout@"):
            assert step["with"]["persist-credentials"] == "false", job_id
        if step.get("uses", "").startswith("actions/upload-artifact@"):
            assert step["with"]["if-no-files-found"] == "error", job_id
            assert 0 < int(step["with"]["retention-days"]) <= 7, job_id
print("Required job inventory, permissions, action pins, timeouts and artifact policy passed.")
