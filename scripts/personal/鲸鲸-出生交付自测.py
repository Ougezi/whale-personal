# -*- coding: utf-8 -*-
"""出生技能 · 交付自测与签收（B7-02）。

--check：检查 25 步证据 + 宪法 hash + 文档/HTML/skill；
--sign <name> --confirm：主人本人签收，写 signoff.json。
不代替主人签收。
"""
import argparse
import hashlib
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLAN = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-执行计划.json')
STATE = os.path.join(ROOT, 'data', 'birth-skills', 'state.json')
EVID = os.path.join(ROOT, 'data', 'birth-skills', 'evidence')
CONST = os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-宪法.md')
SIGNOFF = os.path.join(ROOT, 'data', 'birth-skills', 'signoff.json')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(65536), b''):
            h.update(b)
    return h.hexdigest()


def load():
    plan = json.load(open(PLAN, encoding='utf-8'))
    state = json.load(open(STATE, encoding='utf-8'))
    return plan, state


def check():
    plan, state = load()
    steps = plan['steps']
    done = [s for s in steps if state['steps'].get(s['id'], {}).get('status') == 'done']
    pending = [s['id'] for s in steps if state['steps'].get(s['id'], {}).get('status') != 'done']
    errs = []
    total_pass = total_fail = 0
    for s in steps:
        evp = os.path.join(ROOT, 'data', 'birth-skills', 'evidence', s['id'] + '.json')
        if not os.path.isfile(evp):
            if s['id'] != 'B7-02':
                errs.append('missing evidence ' + s['id'])
            continue
        ev = json.load(open(evp, encoding='utf-8'))
        if s['id'] != 'B7-02':
            total_pass += int(ev.get('tests', {}).get('pass', 0))
            total_fail += int(ev.get('tests', {}).get('fail', 0))
            if len(ev.get('case_ids') or []) < 5:
                errs.append('cases<5 ' + s['id'])
            if not ev.get('rollback'):
                errs.append('rollback missing ' + s['id'])
    if len(done) < 25:
        errs.append('done<25: %d' % len(done))
    if pending and pending != ['B7-02']:
        errs.append('unexpected pending: ' + ','.join(pending))
    if not os.path.isfile(CONST):
        errs.append('constitution missing')
    if not os.path.isfile(os.path.join(ROOT, 'skills', 'whale-birth-skills', 'SKILL.md')):
        errs.append('skill missing')
    if not os.path.isfile(os.path.join(ROOT, 'docs', 'personal', '鲸鲸-出生技能-执行总目录.md')):
        errs.append('directory missing')
    signed = os.path.isfile(SIGNOFF)
    sign = json.load(open(SIGNOFF, encoding='utf-8')) if signed else None
    return {'ok': not errs, 'errors': errs, 'done': len(done), 'total': len(steps),
            'pass': total_pass, 'fail': total_fail, 'pending': pending,
            'constitutionHash': sha256(CONST), 'signed': signed, 'signoff': sign}


def sign(name):
    plan, state = load()
    r = check()
    if not r['ok']:
        raise SystemExit('DoD not met: ' + '; '.join(r['errors']))
    if name.strip() != 'ougezi':
        raise SystemExit('only owner ougezi can sign')
    data = {'by': name.strip(), 'at': int(time.time() * 1000),
            'constitutionHash': r['constitutionHash'], 'done': r['done'],
            'pass': r['pass'], 'fail': r['fail'], 'version': 1}
    os.makedirs(os.path.dirname(SIGNOFF), exist_ok=True)
    with open(SIGNOFF, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    plan, state = load()
    step = next(x for x in plan['steps'] if x['id'] == 'B7-02')
    now = int(time.time() * 1000)
    ev = {
        'version': 1, 'step': 'B7-02', 'status': 'done', 'case_ids': step['case_ids'],
        'source_reviews': [],
        'changes': ['scripts/personal/鲸鲸-出生交付自测.py', 'docs/personal/鲸鲸-出生证明.md', 'skills/whale-birth-skills/SKILL.md'],
        'tests': {'pass': 1, 'fail': 0, 'commands': ['python scripts/personal/鲸鲸-出生交付自测.py --check']},
        'acceptance': [
            {'item': 'DoD 全过', 'ok': True, 'evidence': '25 步 done；B7-02 签收后 done'},
            {'item': '主人签收', 'ok': True, 'evidence': 'signoff.json by ' + name.strip()}],
        'rollback': 'git checkout -- scripts/personal/鲸鲸-出生交付自测.py docs/personal/鲸鲸-出生证明.md skills/whale-birth-skills/SKILL.md data/birth-skills/state.json data/birth-skills/signoff.json',
        'audit': [{'at': now, 'step': 'B7-02', 'action': 'owner.signoff', 'actor': name.strip(), 'risk': 'R0', 'evidence': 'data/birth-skills/signoff.json'}],
        'finishedAt': now,
    }
    os.makedirs(EVID, exist_ok=True)
    with open(os.path.join(EVID, 'B7-02.json'), 'w', encoding='utf-8') as f:
        json.dump(ev, f, ensure_ascii=False, indent=1)
    state['current'] = 'B7-02'
    state['steps']['B7-02'] = {'status': 'done', 'case_ids': step['case_ids'], 'evidence': 'data/birth-skills/evidence/B7-02.json', 'finishedAt': now}
    state['complete'] = True
    with open(STATE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    print('signed', json.dumps(data, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--sign')
    ap.add_argument('--confirm', action='store_true')
    a = ap.parse_args()
    if a.sign:
        if not a.confirm:
            raise SystemExit('need --confirm')
        sign(a.sign)
        return 0
    r = check()
    print(json.dumps(r, ensure_ascii=False, indent=1))
    return 0 if r['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
