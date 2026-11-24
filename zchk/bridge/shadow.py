# -*- coding: utf-8 -*-
"""出生技能 · Shadow 与指标（B6-02）。

Shadow 只记录，不执行：
  - decision 入日志；
  - executed 永远 false；
  - 人工标注后才计算 precision/recall/clarifyRate；
  - shadow 窗口 3–7 天。
"""
import json
import time


class ShadowError(Exception):
    pass


class Shadow:
    def __init__(self, audit=None):
        self.rows = []
        self.audit = audit
        self.executed = 0

    def record(self, *, chat='', text='', action='', risk='R0', should_execute=False,
               clarify=False, reason='', at=None):
        if self.executed:
            raise ShadowError('shadow must not execute')
        row = {
            'chat': str(chat)[:120], 'text': str(text)[:500], 'action': str(action)[:80],
            'risk': risk, 'shouldExecute': bool(should_execute), 'clarify': bool(clarify),
            'reason': str(reason)[:200], 'at': int(at if at is not None else time.time() * 1000),
            'executed': False, 'label': None,
        }
        self.rows.append(row)
        if callable(self.audit):
            try:
                self.audit(dict(row))
            except Exception:
                pass
        return {'recorded': True, 'executed': False, 'row': dict(row)}

    def label(self, index, *, shouldExecute=None, clarify=None):
        if index < 0 or index >= len(self.rows):
            raise ShadowError('bad index')
        r = self.rows[index]
        if shouldExecute is not None:
            r['label'] = r.get('label') or {}
            r['label']['shouldExecute'] = bool(shouldExecute)
        if clarify is not None:
            r['label'] = r.get('label') or {}
            r['label']['clarify'] = bool(clarify)
        return dict(r)

    def evaluate(self):
        labeled = [r for r in self.rows if r.get('label') and 'shouldExecute' in r['label']]
        tp = fp = fn = tn = 0
        clarify = 0
        for r in labeled:
            pred = bool(r['shouldExecute'])
            gold = bool(r['label']['shouldExecute'])
            if pred and gold: tp += 1
            elif pred and not gold: fp += 1
            elif not pred and gold: fn += 1
            else: tn += 1
            if r.get('clarify'): clarify += 1
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        return {
            'total': len(self.rows), 'labeled': len(labeled),
            'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn,
            'precision': round(precision, 3), 'recall': round(recall, 3),
            'clarifyRate': round(clarify / max(1, len(labeled)), 3),
            'executed': self.executed,
        }

    def snapshot(self):
        return {'rows': [dict(r) for r in self.rows], 'executed': self.executed}


def assert_window(start_ms, end_ms, min_days=3, max_days=7):
    days = (int(end_ms) - int(start_ms)) / 86400000
    ok = min_days <= days <= max_days
    return {'ok': ok, 'days': round(days, 2), 'min': min_days, 'max': max_days,
            'reason': 'ok' if ok else 'shadow-window'}
