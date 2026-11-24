# -*- coding: utf-8 -*-
"""出生技能 · 进化沙箱（B4-02）。

隔离原则：
  - 只在临时目录复制/改文件，绝不碰 main_root；
  - unified diff 先校验再应用；上下文不匹配就拒绝；
  - 测试失败/评测失败自动清理沙箱，不提升；
  - 回滚 = 删沙箱；主链 hash 前后必须一致。

本步不做真实 git 操作；用注入的 test_runner/evaluator 保证可测。
"""
import hashlib
import os
import re
import shutil
import subprocess
import tempfile


class SandboxError(Exception):
    pass


def _sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(65536), b''):
            h.update(b)
    return h.hexdigest()


def fingerprint(root, files):
    out = {}
    for rel in files:
        p = os.path.join(root, rel)
        out[rel] = _sha(p) if os.path.isfile(p) else None
    return out


def create_sandbox(main_root, files, base=None):
    root = tempfile.mkdtemp(prefix='whale-evo-sandbox-', dir=base)
    for rel in files:
        src = os.path.join(main_root, rel)
        dst = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
    return {'root': root, 'files': list(files), 'mainRoot': main_root}


def _parse_hunks(diff):
    lines = str(diff or '').splitlines(True)
    hunks = []
    cur = None
    for line in lines:
        m = re.match(r'^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@', line)
        if m:
            cur = {'oldStart': int(m.group(1)), 'oldCount': int(m.group(2) or 1),
                   'newStart': int(m.group(3)), 'newCount': int(m.group(4) or 1), 'lines': []}
            hunks.append(cur)
            continue
        if cur is not None and line[:1] in (' ', '+', '-') and not line.startswith(('---', '+++')):
            cur['lines'].append(line.rstrip('\n'))
    return hunks


def apply_diff(sandbox, diff):
    """最小 unified diff 应用：只处理已声明文件 + 精确上下文。"""
    root = sandbox['root']
    target = None
    for line in str(diff or '').splitlines():
        if line.startswith('+++ '):
            target = line[4:].strip().split('\t')[0]
            if target.startswith('b/'):
                target = target[2:]
    if not target:
        raise SandboxError('diff has no target file')
    if target not in sandbox['files']:
        raise SandboxError('target not declared: ' + target)
    hunks = _parse_hunks(diff)
    if not hunks:
        raise SandboxError('diff has no hunks')
    path = os.path.join(root, target)
    old = open(path, encoding='utf-8').read().splitlines() if os.path.isfile(path) else []
    out = []
    cursor = 0
    for h in hunks:
        start = max(0, h['oldStart'] - 1)
        out.extend(old[cursor:start])
        idx = start
        for ln in h['lines']:
            tag, body = (ln[0], ln[1:]) if ln else (' ', '')
            if tag == ' ':
                if idx >= len(old) or old[idx] != body:
                    raise SandboxError('context mismatch at line %d' % (idx + 1))
                out.append(old[idx]); idx += 1
            elif tag == '-':
                if idx >= len(old) or old[idx] != body:
                    raise SandboxError('delete mismatch at line %d' % (idx + 1))
                idx += 1
            elif tag == '+':
                out.append(body)
        cursor = idx
    out.extend(old[cursor:])
    os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out) + ('\n' if out else ''))
    return {'ok': True, 'file': target, 'lines': len(out)}


def run_tests(root, commands, timeout=60):
    results = []
    for cmd in commands:
        try:
            p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
            results.append({'cmd': cmd, 'ok': p.returncode == 0, 'code': p.returncode,
                            'stdout': (p.stdout or '')[-1000:], 'stderr': (p.stderr or '')[-1000:]})
        except subprocess.TimeoutExpired:
            results.append({'cmd': cmd, 'ok': False, 'code': 'timeout', 'stdout': '', 'stderr': ''})
        except Exception as e:
            results.append({'cmd': cmd, 'ok': False, 'code': 'error', 'stdout': '', 'stderr': str(e)[:300]})
    return {'ok': all(x['ok'] for x in results), 'results': results}


def run_shadow(cases, evaluator):
    """独立评测：evaluator 由调用方注入，不在沙箱里自评。"""
    rows = []
    for c in cases:
        try:
            rows.append({'case': c, 'ok': bool(evaluator(c))})
        except Exception as e:
            rows.append({'case': c, 'ok': False, 'error': str(e)[:200]})
    return {'ok': all(x['ok'] for x in rows), 'results': rows}


def cleanup(sandbox):
    root = sandbox.get('root') if isinstance(sandbox, dict) else sandbox
    if root and os.path.isdir(root):
        shutil.rmtree(root, ignore_errors=True)
    return {'ok': True}


def run_cycle(main_root, files, diff, tests, cases=None, evaluator=None, timeout=60, test_runner=None, shadow_runner=None):
    """完整沙箱循环：复制 → diff → 测试 → shadow → 清理。
    主链只读；不改 main_root，不复制回主链。
    """
    before = fingerprint(main_root, files)
    sandbox = create_sandbox(main_root, files)
    report = {'ok': False, 'stage': 'setup', 'sandbox': sandbox['root'], 'mainUnchanged': False}
    try:
        report['stage'] = 'diff'
        apply_diff(sandbox, diff)
        report['stage'] = 'tests'
        test_runner = test_runner or run_tests
        tr = test_runner(sandbox['root'], tests, timeout)
        report['tests'] = tr
        if not tr.get('ok'):
            report['reason'] = 'tests_failed'
            return report
        report['stage'] = 'shadow'
        if cases is not None and evaluator is not None:
            shadow_runner = shadow_runner or run_shadow
            sr = shadow_runner(cases, evaluator)
            report['shadow'] = sr
            if not sr.get('ok'):
                report['reason'] = 'shadow_failed'
                return report
        after = fingerprint(main_root, files)
        report['mainUnchanged'] = before == after
        report['ok'] = report['mainUnchanged']
        report['stage'] = 'passed' if report['ok'] else 'main_changed'
        report['reason'] = 'ok' if report['ok'] else 'main_changed'
        return report
    except Exception as e:
        report['reason'] = 'sandbox_error'
        report['error'] = str(e)[:300]
        return report
    finally:
        cleanup(sandbox)
