# -*- coding: utf-8 -*-
"""兴趣 3 天实验验收：到期、样本、假动作、重复、开关、证据完整性。"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'dist' / 'whale-personal'
DATA = DIST / 'data'
BASE = DATA / 'integration' / 'hobby-experiment.json'
CHAT = os.environ.get('WHALE_ACCEPT_CHAT', 'wechat:u:<master>')
TZ = timezone(timedelta(hours=8))
FAKE = re.compile(r'这次是真写|我写了一张|我画了一张|我拍了一张|我写好了|我画好了|我去了|我买了|我拍了')
NAMES = {'攒小东西': 'collect-small-things', '雨后的味道': 'rain-smell', '手写小纸条': 'small-notes'}


def load(path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def now():
    return datetime.now(TZ)


def report(base, issues, warnings, activity):
    interests = load(DATA / 'interests.json', {}) or {}
    rows = interests.get('interests') or []
    return {
        'ok': not issues and activity >= 10,
        'accepted': False,
        'startAt': base.get('startAt'),
        'endAt': base.get('endAt'),
        'checkedAt': now().isoformat(),
        'activity': activity,
        'issues': issues,
        'warnings': warnings,
        'interests': [
            {'id': x.get('id'), 'status': x.get('status'), 'strength': x.get('strength'), 'evidence': len(x.get('evidence') or [])}
            for x in rows
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--accept', action='store_true')
    args = ap.parse_args()

    base = load(BASE)
    if not base:
        print('FAIL: missing hobby-experiment.json')
        return 2
    end = datetime.fromisoformat(base['endAt'])
    if now() < end:
        print(f'NOT DUE: now={now().isoformat()} end={base["endAt"]}')
        return 2

    issues, warnings = [], []
    chat = load(DATA / 'config.json', {}) or {}
    hobbies = (chat.get('features') or {}).get('hobbies') is True
    chats = ((chat.get('hobbies') or {}).get('chats') or [])
    if not hobbies:
        issues.append('hobbies 已被关闭')
    if CHAT not in chats:
        issues.append('测试 chat 不在 hobbies.chats')

    start_ms = int(datetime.fromisoformat(base['startAt']).timestamp() * 1000)
    path = None
    rows = []
    try:
        for cand in sorted((DATA / 'memory' / 'chats').glob('*/messages.jsonl')):
            first = next((json.loads(x) for x in cand.read_text(encoding='utf-8').splitlines() if x.strip()), {})
            if first.get('chatId') == CHAT:
                path = cand
                break
        if path is None:
            raise FileNotFoundError('未找到 chat 记忆目录')
        rows = [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]
    except Exception as exc:
        issues.append('messages 读取失败: %s' % exc)
    new = [m for m in rows if int(m.get('ts') or 0) >= start_ms]
    activity = sum(1 for m in new if m.get('role') == 'user')
    if activity < 10:
        issues.append('有效 user 消息不足 10 条：%d' % activity)

    prev = None
    seen_names = {}
    for m in new:
        if m.get('role') == 'assistant':
            text = str(m.get('text') or '')
            if FAKE.search(text):
                issues.append('假动作: seq=%s %s' % (m.get('seq'), text[:60]))
            norm = re.sub(r'\s+', '', text)
            if prev and prev.get('role') == 'assistant' and re.sub(r'\s+', '', str(prev.get('text') or '')) == norm:
                issues.append('连续重复: seq=%s/%s' % (prev.get('seq'), m.get('seq')))
            day = datetime.fromtimestamp(int(m.get('ts')) / 1000, TZ).date().isoformat()
            for name, iid in NAMES.items():
                if name in text:
                    seen_names[(iid, day)] = seen_names.get((iid, day), 0) + 1
        prev = m

    for (iid, day), n in seen_names.items():
        if n > 2:
            warnings.append('同一兴趣当日超过 2 次: %s %s=%d' % (iid, day, n))

    data = load(DATA / 'interests.json', {}) or {}
    for x in data.get('interests') or []:
        for e in x.get('evidence') or []:
            if not e.get('ref') or not e.get('kind'):
                issues.append('证据缺 ref/kind: %s' % x.get('id'))

    out = report(base, issues, warnings, activity)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    if args.accept and out['ok']:
        out['accepted'] = True
        (DATA / 'integration' / 'evidence' / 'hobby-experiment-accepted.json').write_text(
            json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
        base['status'] = 'accepted'
        base['acceptedAt'] = now().isoformat()
        BASE.write_text(json.dumps(base, ensure_ascii=False, indent=1), encoding='utf-8')
        print('ACCEPTED')
    return 0 if out['ok'] and args.accept else (1 if not out['ok'] else 2)


if __name__ == '__main__':
    sys.exit(main())
