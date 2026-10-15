"""Keep hosted CI manual, explicitly tiered and cheap by default."""
import json
import re
from pathlib import Path

import yaml

if not __debug__:
    raise RuntimeError('Workflow policy must run with assertions enabled')

root = Path(__file__).resolve().parent.parent
workflow_files = {p.name for p in (root / '.github/workflows').iterdir() if p.suffix in {'.yml', '.yaml'}}
assert workflow_files == {'ci.yml'}, 'Review the budget before adding another hosted workflow'
with (root / '.github/workflows/ci.yml').open(encoding='utf-8') as handle:
    workflow = yaml.load(handle, Loader=yaml.BaseLoader)
suites = json.loads((root / '.github/required-ci-jobs.json').read_text(encoding='utf-8'))
jobs = workflow['jobs']
assert len(jobs) == 10, 'Review hosted job growth against the budget'
assert set(workflow['on']) == {'workflow_dispatch'}, 'Hosted runs require explicit manual dispatch'
choice = workflow['on']['workflow_dispatch']['inputs']['suite']
assert choice['type'] == 'choice' and choice['default'] == 'checks'
assert choice['options'] == ['checks', 'core', 'full']
assert set(suites) == {'checks', 'core', 'full'}
assert suites['checks'] == ['workflow-policy'], 'Default suite must stay one lightweight job'
assert len(suites['full']) == len(set(suites['full']))
assert set(suites['full']) == set(jobs) - {'required-gate'}
assert set(suites['core']) == set(suites['full']) - {'desktop', 'media-browser'}
assert workflow['permissions'] == {'contents': 'read'}
assert workflow['concurrency']['cancel-in-progress'] == 'true'
core_condition = "${{ inputs.suite == 'core' || inputs.suite == 'full' }}"
full_condition = "${{ inputs.suite == 'full' }}"
core_jobs = set(suites['core']) - {'workflow-policy'}
for job_id, job in jobs.items():
    assert 0 < int(job['timeout-minutes']) <= 90, job_id
    assert 'continue-on-error' not in job, job_id
    assert 'permissions' not in job or job['permissions'] == {'contents': 'read'}, job_id
    if job_id == 'workflow-policy':
        assert 'if' not in job and 'strategy' not in job
        assert job['runs-on'] == 'ubuntu-latest'
        assert int(job['timeout-minutes']) <= 5
        assert not any('rust-toolchain@' in s.get('uses', '') for s in job['steps'])
    elif job_id in core_jobs:
        assert job['if'] == core_condition, job_id
        assert job['runs-on'] == 'ubuntu-latest' and 'strategy' not in job, job_id
    elif job_id in {'desktop', 'media-browser'}:
        assert job['if'] == full_condition, job_id
        assert set(job['needs']) == core_jobs, 'Expensive platforms must wait for Linux acceptance'
        assert job['strategy']['fail-fast'] == 'true', job_id
    for step in job['steps']:
        assert 'continue-on-error' not in step, job_id
        if 'uses' in step:
            assert re.fullmatch(r'[\w.-]+/[\w./-]+@[0-9a-f]{40}', step['uses']), step['uses']
        if step.get('uses', '').startswith('actions/checkout@'):
            assert step['with']['persist-credentials'] == 'false', job_id
        if step.get('uses', '').startswith('actions/upload-artifact@'):
            assert step['with']['if-no-files-found'] == 'error', job_id
            assert step['with']['retention-days'] == '1', job_id
assert jobs['desktop']['strategy']['matrix']['os'] == ['ubuntu-22.04', 'macos-latest', 'windows-latest']
assert len(jobs['media-browser']['strategy']['matrix']['include']) == 3
gate = jobs['required-gate']
assert 'strategy' not in gate, 'The acceptance result gate must stay one job'
assert set(gate['needs']) == set(suites['full'])
assert gate['name'] == 'Acceptance (${{ inputs.suite }})'
assert gate['if'] == "${{ always() && (inputs.suite == 'core' || inputs.suite == 'full') }}"
assert int(gate['timeout-minutes']) <= 3
assert gate['steps'][-1]['env']['HEARTH_CI_SUITE'] == '${{ inputs.suite }}'
print('Manual-only CI, cheap default, suite coverage, Linux-first staging and storage policy passed.')
