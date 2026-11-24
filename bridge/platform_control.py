# -*- coding: utf-8 -*-
"""P3 · 平台发布控制：birth_config / rollout / genome / sandbox / redteam。"""
import hashlib
import json
import os
import tempfile

from birth_config import BirthConfig, BirthConfigError
from rollout import Rollout, RolloutError
from evolution.genome import GenomeRegistry, GenomeError, fingerprint
from evolution.sandbox import run_cycle
from redteam import run_redteam

CONSTITUTION_HASH = hashlib.sha256(b'whale-platform-callers-v1').hexdigest()


def _path(data_dir, name):
    return os.path.join(data_dir, name)


def birth_status(data_dir):
    p = _path(data_dir, 'birth-config.json')
    if not os.path.exists(p):
        return BirthConfig().snapshot()
    return BirthConfig.load(p).snapshot()


def birth_set(data_dir, skill, enabled):
    p = _path(data_dir, 'birth-config.json')
    cfg = BirthConfig.load(p) if os.path.exists(p) else BirthConfig()
    snap = cfg.set_skill(skill, bool(enabled))
    cfg.save(p)
    return snap


def rollout_status(data_dir):
    p = _path(data_dir, 'platform-rollout.json')
    if not os.path.exists(p):
        return {'percent': {}, 'source': 'none'}
    try:
        return {'percent': json.load(open(p, encoding='utf-8')), 'source': p}
    except Exception:
        return {'percent': {}, 'source': 'bad-json'}


def rollout_set(data_dir, platform, percent):
    p = _path(data_dir, 'platform-rollout.json')
    data = {}
    if os.path.exists(p):
        try:
            data = json.load(open(p, encoding='utf-8'))
        except Exception:
            data = {}
    data[str(platform)] = max(0, min(100, int(percent)))
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    return rollout_status(data_dir)


def genome_register(data_dir, version):
    p = _path(data_dir, 'platform-genome.json')
    data = {}
    if os.path.exists(p):
        try:
            data = json.load(open(p, encoding='utf-8'))
        except Exception:
            data = {}
    reg = GenomeRegistry(constitution_hash=CONSTITUTION_HASH)
    for v, item in (data.get('versions') or {}).items():
        try:
            reg.versions[int(v)] = {'genome': item.get('genome') or item, 'fingerprint': item.get('fingerprint') or fingerprint(item.get('genome') or item), 'status': item.get('status') or 'registered'}
            reg.active = int(v) if item.get('status') == 'live' else reg.active
        except Exception:
            pass
    genome = {
        'schemaVersion': 1,
        'constitution': {'readonly': True, 'hash': CONSTITUTION_HASH},
        'versions': {'genome': int(version), 'skills': {'grow': False, 'chat': True, 'dsh': True}},
        'adapters': {'github': 1, 'bilibili': 1, 'douyin': 1},
    }
    out = reg.register(genome)
    data = {'schemaVersion': 1, 'constitution': {'readonly': True, 'hash': CONSTITUTION_HASH},
            'versions': {}, 'active': reg.active}
    for v, item in reg.versions.items():
        data['versions'][str(v)] = {'genome': item['genome'], 'fingerprint': item['fingerprint'], 'status': item['status']}
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    return {'ok': True, 'version': int(version), 'fingerprint': out['fingerprint'], 'active': reg.active}


def genome_status(data_dir):
    p = _path(data_dir, 'platform-genome.json')
    if not os.path.exists(p):
        return {'ok': False, 'reason': 'no-genome'}
    return {'ok': True, 'data': json.load(open(p, encoding='utf-8'))}


def sandbox_run(main_root, files, diff, expected):
    """在临时目录应用 diff，检查 expected 文件内容；主链 hash 必须不变。"""
    def test_runner(root, tests, timeout):
        rows = []
        for rel, want in (tests or []):
            path = os.path.join(root, rel)
            got = open(path, encoding='utf-8').read() if os.path.isfile(path) else ''
            rows.append({'file': rel, 'ok': got == want, 'got': got[:80]})
        return {'ok': all(x['ok'] for x in rows), 'results': rows}
    return run_cycle(main_root, files, diff, list(expected.items()), test_runner=test_runner)


def redteam_run():
    class Policy:
        def check_action(self, text, workspace, mode):
            return {'ok': False, 'reason': 'test-policy'}
    class Bus:
        def dispatch(self, *a, **k):
            raise RuntimeError('target not allowed')
    return run_redteam(Policy(), Bus())
