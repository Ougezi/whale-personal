# -*- coding: utf-8 -*-
"""出生技能 · 基因组注册/版本/回滚（B4-03）。

- 每个 genome 带 fingerprint（canonical JSON sha256）；
- 版本只增，注册坏版本直接拒绝；
- canary 指标不达标不进 live；
- freeze 后禁止提升；
- rollback 回上一个 live 版本，保留历史。
"""
import hashlib
import json


class GenomeError(Exception):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def fingerprint(genome):
    return hashlib.sha256(canonical(genome).encode('utf-8')).hexdigest()


def _required(genome):
    if not isinstance(genome, dict):
        return ['root must be object']
    errs = []
    for k in ('schemaVersion', 'constitution', 'versions'):
        if k not in genome:
            errs.append('missing ' + k)
    c = genome.get('constitution') or {}
    if c.get('readonly') is not True:
        errs.append('constitution.readonly must be true')
    if not isinstance(c.get('hash'), str) or len(c.get('hash')) != 64:
        errs.append('constitution.hash invalid')
    v = genome.get('versions') or {}
    if not isinstance(v.get('genome'), int) or v['genome'] < 1:
        errs.append('versions.genome invalid')
    return errs


class GenomeRegistry:
    def __init__(self, constitution_hash=None, min_canary_score=0.85):
        self.constitution_hash = constitution_hash
        self.min_canary_score = float(min_canary_score)
        self.versions = {}
        self.active = None
        self.previous = None
        self.frozen = False
        self.history = []

    def _check(self, genome):
        errs = _required(genome)
        if self.constitution_hash:
            c = genome.get('constitution') or {}
            if c.get('hash') != self.constitution_hash:
                errs.append('constitution.hash does not match')
        return errs

    def register(self, genome):
        if self.frozen:
            raise GenomeError('frozen')
        errs = self._check(genome)
        if errs:
            raise GenomeError('bad genome: ' + '; '.join(errs))
        version = int(genome['versions']['genome'])
        if version in self.versions:
            raise GenomeError('version exists: %d' % version)
        if self.versions and version <= max(self.versions):
            raise GenomeError('version must increase: %d' % version)
        fp = fingerprint(genome)
        if any(v['fingerprint'] == fp for v in self.versions.values()):
            raise GenomeError('duplicate fingerprint')
        self.versions[version] = {'genome': genome, 'fingerprint': fp, 'status': 'registered'}
        if self.active is None:
            self.active = version
            self.versions[version]['status'] = 'live'
        self.history.append({'action': 'register', 'version': version, 'fingerprint': fp})
        return self.versions[version]

    def canary(self, version, metrics=None):
        if self.frozen:
            raise GenomeError('frozen')
        if version not in self.versions:
            raise GenomeError('unknown version: %d' % version)
        m = metrics or {}
        score = float(m.get('score', 0))
        errors = int(m.get('errors', 0))
        ok = score >= self.min_canary_score and errors == 0
        self.versions[version]['status'] = 'canary-pass' if ok else 'canary-failed'
        return {'ok': ok, 'version': version, 'score': score, 'errors': errors,
                'threshold': self.min_canary_score}

    def promote(self, version, metrics=None):
        if self.frozen:
            raise GenomeError('frozen')
        if version not in self.versions:
            raise GenomeError('unknown version: %d' % version)
        c = self.canary(version, metrics)
        if not c['ok']:
            return {'ok': False, 'reason': 'canary-failed', 'canary': c, 'active': self.active}
        old = self.active
        if old is not None and old in self.versions:
            self.versions[old]['status'] = 'retired'
        self.previous = old
        self.active = version
        self.versions[version]['status'] = 'live'
        self.history.append({'action': 'promote', 'from': old, 'to': version})
        return {'ok': True, 'version': version, 'previous': old, 'canary': c}

    def rollback(self, target=None):
        if target is None:
            target = self.previous
        if target is None or target not in self.versions:
            raise GenomeError('no rollback target')
        if self.active is None:
            raise GenomeError('no active version')
        old = self.active
        if old in self.versions:
            self.versions[old]['status'] = 'retired'
        self.versions[target]['status'] = 'live'
        self.active = target
        self.previous = old
        self.history.append({'action': 'rollback', 'from': old, 'to': target})
        return {'ok': True, 'from': old, 'to': target}

    def freeze(self):
        self.frozen = True
        self.history.append({'action': 'freeze'})
        return self.snapshot()

    def snapshot(self):
        return {'active': self.active, 'previous': self.previous, 'frozen': self.frozen,
                'versions': {str(k): {'status': v['status'], 'fingerprint': v['fingerprint']}
                             for k, v in self.versions.items()},
                'history': list(self.history)}
