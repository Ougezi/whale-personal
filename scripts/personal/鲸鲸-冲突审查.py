# -*- coding: utf-8 -*-
"""冲突审查：全局（跨文件一致性）+ 局部（单个改动的内部矛盾）。

用法：
    python 鲸鲸-冲突审查.py                 # 全局审查（默认）
    python 鲸鲸-冲突审查.py --local a.py b.js   # 局部审查指定文件
    python 鲸鲸-冲突审查.py --global        # 显式全局

判定：只报**真冲突**（同一件事两个地方说法不一致、引用了不存在的东西、
守则要求的代码不存在）。风格问题不算。
退出码 0 = 没有冲突。
"""
import ast
import json
import os
import re
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("WHALE_ROOT") or os.path.abspath(os.path.join(_HERE, "..", ".."))
W = r"D:\dsh\profiles\desktop"
BRIDGE = os.path.join(ROOT, "bridge")
SRC = os.path.join(ROOT, "src")
PY = os.path.join(ROOT, "runtime", "python", "python.exe")
NODE = os.path.join(ROOT, "runtime", "node.exe")
CONFLICTS = []


def read(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def jload(p, default=None):
    try:
        with open(p, encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}


def conflict(where, msg):
    CONFLICTS.append((where, msg))
    print("  ✗ [%s] %s" % (where, msg))


def ok(msg):
    print("  ✓ " + msg)


# ---------------------------------------------------------------- 全局检查
def check_rules_vs_code():
    """守则里承诺的行为，代码里必须真的存在。"""
    print("\n[1] 执行守则 ↔ 代码")
    agent = read(os.path.join(BRIDGE, "dsh_agent.py"))
    receiver = read(os.path.join(BRIDGE, "receiver_mixin.py"))

    if "def rules_text(continuous" not in agent:
        conflict("守则", "代码里没有 rules_text(continuous)")
    if "DEFAULT_CWD" not in agent or "ROOT" not in agent:
        conflict("守则", "守则没有同时给出 cwd 和 应用根目录")
    if "split_bypass" not in agent:
        conflict("守则", "没有 split_bypass（「直接做：」前缀不会被剥）")
    else:
        ok("前缀剥离 split_bypass 存在")
    if re.search(r"def run_task\([^)]*continuous", agent, re.S):
        ok("run_task 支持 continuous")
    else:
        conflict("守则", "run_task 没有 continuous 参数，守则第 2 条例外无法生效")
    if "continuous=True" in receiver:
        ok("自我改代码走连续模式")
    else:
        conflict("守则", "自我改代码没传 continuous=True，会被「只做第一件」截断")

    # 「一次做几件事」必须由并发上限派生，否则改上限时守则不会跟着变
    if "def per_task_limit(" not in agent:
        conflict("守则", "没有 per_task_limit()：一件/多件的口径和并发上限脱钩了")
    elif agent.count("per_task_limit") < 4:
        conflict("守则", "per_task_limit 定义/使用了但没贯通（守则或分诊仍写死数字）")
    else:
        ok("「一次最多做 N 件」由并发上限派生（N = 上限 − 1）")

    # 旧常量 RULES 不该再被引用（改成函数后残留=死引用）
    bare = [ln for ln in agent.splitlines()
            if re.search(r"(?<![A-Za-z_])RULES(?![A-Za-z_])", ln) and "rules_text" not in ln]
    if bare:
        conflict("守则", "还有地方引用旧的 RULES 常量：%s" % bare[0].strip()[:50])
    else:
        ok("没有残留的 RULES 引用")


def check_config_vs_code():
    print("\n[2] 配置 ↔ 代码")
    cfg = jload(os.path.join(ROOT, "data", "config.json"))
    feats = {k: v for k, v in (cfg.get("features") or {}).items() if not k.startswith("_")}
    reg = set()
    fsrc = read(os.path.join(SRC, "infra", "features.js"))
    for m in re.finditer(r"key:\s*'([A-Za-z0-9_]+)'", fsrc):
        reg.add(m.group(1))
    unknown = [k for k in feats if reg and k not in reg]
    if unknown:
        conflict("配置", "features 里有未注册的键：%s" % "、".join(unknown))
    else:
        ok("features 键全部已注册（%d 个）" % len(feats))

    deleg = cfg.get("delegation") or {}
    agent = read(os.path.join(BRIDGE, "dsh_agent.py"))
    for key in ("timeout", "maxConcurrent", "maxPerDay"):
        if 'd.get("%s")' % key not in agent and "%s" % key not in agent:
            conflict("配置", "dsh_agent 没读 delegation.%s" % key)
    for key in ("adaptiveTimeout", "smallSeconds", "mediumSeconds"):
        if key not in agent:
            conflict("配置", "dsh_agent 没实现 delegation.%s（自适应超时失效）" % key)
    if not any(c[1].startswith("dsh_agent 没") for c in CONFLICTS):
        ok("delegation 的键代码都在用")

    sc = cfg.get("selfcheck") or {}
    if "intervalMinutes" not in read(os.path.join(BRIDGE, "selfcheck.py")):
        conflict("配置", "selfcheck.py 没读 intervalMinutes")
    else:
        ok("selfcheck 配置项代码在用（每 %s 分钟）" % sc.get("intervalMinutes"))


def check_docs_vs_code():
    print("\n[3] 文档 ↔ 代码")
    script = os.path.join(W, "鲸鲸-文档同步.py")
    if not os.path.exists(script):
        conflict("文档", "找不到 鲸鲸-文档同步.py")
        return
    env = dict(os.environ)
    env['WHALE_ROOT'] = ROOT
    r = subprocess.run([sys.executable, script], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=60, env=env)
    if r.returncode == 0:
        ok("文档参数块与代码/配置一致")
    else:
        drift = [l.strip() for l in (r.stdout or "").splitlines() if "需更新" in l or "缺" in l]
        conflict("文档", "参数漂移：%s" % "；".join(drift)[:80])


def check_memory_vs_ledger():
    print("\n[4] 记忆 ↔ 能力台账")
    ledger = jload(os.path.join(W, "鲸鲸-能力台账.json")).get("entries") or []
    cfg = jload(os.path.join(ROOT, "data", "config.json"))
    wxids = ((cfg.get("persona") or {}).get("master") or {}).get("wxids") or [""]
    wxid = wxids[0]
    card = None
    base = os.path.join(ROOT, "data", "memory", "chats")
    for chat in (os.listdir(base) if os.path.isdir(base) else []):
        ppl = os.path.join(base, chat, "people")
        if not os.path.isdir(ppl):
            continue
        for name in os.listdir(ppl):
            if not name.endswith(".json"):
                continue
            d = jload(os.path.join(ppl, name))
            if str(d.get("chatId") or "") == "wechat:u:" + wxid:
                card = d
    if not card:
        conflict("记忆", "找不到主人人物卡")
        return
    act = [p for p in (card.get("preferences") or [])
           if not p.get("deleted") and not p.get("superseded")]
    texts = [str(p.get("text")) for p in act]
    # 记忆写入会把偏好截断到 80 字（personCard.text(...,80)），
    # 所以台账 assert 超过 80 就一定对不上——先拦长度，再按截断值比对
    too_long = [e.get("assert") for e in ledger if e.get("assert") and len(e["assert"]) > 80]
    if too_long:
        conflict("台账", "%d 条 assert 超过 80 字，进记忆会被截断：%s" % (
            len(too_long), too_long[0][:24]))
    missing = [e.get("assert") for e in ledger
               if e.get("assert") and e["assert"][:80] not in [t[:80] for t in texts]]
    if missing:
        conflict("记忆", "台账里 %d 条认知没进记忆：%s" % (
            len(missing), "；".join(m[:18] for m in missing[:2])))
    else:
        ok("台账 %d 条认知都已在记忆里生效" % len(ledger))

    stale = []
    for e in ledger:
        for pat in (e.get("retire") or []):
            hit = [t for t in texts if pat in t]
            if hit:
                stale.append("%s(%s)" % (pat, hit[0][:14]))
    if stale:
        conflict("记忆", "还有过时说法在生效：%s" % "；".join(stale[:3]))
    else:
        ok("没有应该作废却还在生效的说法")


def check_script_refs():
    print("\n[5] 技能/文档里引用的脚本是否存在")
    names = set()
    for base in (os.path.join(W, "skills"),):
        pass
    targets = []
    for d in (r"D:\dsh\skills", W):
        if not os.path.isdir(d):
            continue
        for root_, _, files in os.walk(d):
            for f in files:
                if f.endswith((".md",)):
                    targets.append(os.path.join(root_, f))
    for p in targets:
        t = read(p)
        for m in re.finditer(r"(鲸鲸-[A-Za-z\u4e00-\u9fff\-]+\.(?:py|ps1|js))(?![a-zA-Z])", t):
            names.add(m.group(1))
    missing = []
    roots = [W, os.path.join(W, "tools"), os.path.join(ROOT, "scripts", "personal"),
             os.path.join(W, "scripts", "personal"), ROOT]
    for n in sorted(names):
        if not any(os.path.exists(os.path.join(r, n)) for r in roots):
            missing.append(n)
    if missing:
        conflict("引用", "文档/技能里提到的脚本不存在：%s" % "、".join(missing))
    else:
        ok("引用的 %d 个脚本都存在" % len(names))


def check_syntax():
    print("\n[6] 语法（改动容易撞车的地方）")
    bad = 0
    for f in sorted(os.listdir(BRIDGE)):
        if not f.endswith(".py"):
            continue
        p = os.path.join(BRIDGE, f)
        try:
            compile(read(p), p, "exec")
        except SyntaxError as e:
            conflict("语法", "%s 第 %s 行：%s" % (f, e.lineno, e.msg))
            bad += 1
    if not bad:
        ok("bridge 下 %d 个 py 全部编译通过" % len([f for f in os.listdir(BRIDGE) if f.endswith(".py")]))
    for rel in ("src/pipeline/chat.js", "src/persona/prompt.js", "src/memory/store.js",
                "src/memory/retrieval.js", "src/core/mood.js", "src/core/selfRules.js",
                "src/core/embed.js", "src/http/routes/memory.js"):
        p = os.path.join(ROOT, rel)
        r = subprocess.run([NODE, "--check", p], capture_output=True, text=True)
        if r.returncode != 0:
            conflict("语法", "%s 编译失败" % rel)


# ---------------------------------------------------------------- 局部检查
def check_local(files):
    print("\n[局部] 逐文件审查")
    for f in files:
        p = f if os.path.isabs(f) else os.path.join(ROOT, f)
        if not os.path.exists(p):
            conflict("局部", "文件不存在：%s" % f)
            continue
        text = read(p)
        if p.endswith(".py"):
            try:
                tree = ast.parse(text)
            except SyntaxError as e:
                conflict("局部", "%s 语法错误 第 %s 行：%s" % (os.path.basename(p), e.lineno, e.msg))
                continue
            funcs = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
            dup = [x for x in set(funcs) if funcs.count(x) > 1]
            if dup:
                conflict("局部", "%s 重复定义函数：%s" % (os.path.basename(p), "、".join(dup)))
            # 自己调用自己的函数名但没定义（拼写错）
            defined = set(funcs)
            called = {n.func.id for n in ast.walk(tree)
                      if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
            suspicious = [c for c in called if c in ("rules_text", "build_prompt", "split_bypass",
                                                    "classify", "timeout_for", "split_suggestion")
                          and c not in defined]
            if suspicious:
                conflict("局部", "%s 调用了未定义的内部函数：%s" % (os.path.basename(p), "、".join(suspicious)))
        elif p.endswith(".js"):
            r = subprocess.run([NODE, "--check", p], capture_output=True, text=True)
            if r.returncode != 0:
                conflict("局部", "%s 编译失败" % os.path.basename(p))
        if re.search(r"\bTODO\b|\bFIXME\b", text):
            print("  · %s 里有 TODO/FIXME（提醒，不算冲突）" % os.path.basename(p))
        ok("检查过 %s" % os.path.basename(p))


# ---------------------------------------------------------------- 脏数据
def check_dirty(clean=False):
    """脏数据：空条目、坏行、悬空索引、坏 JSON。--clean 修可安全修的。"""
    print("\n[7] 脏数据")
    import glob
    card_p = os.path.join(ROOT, "data", "memory", "chats", "cf005acfd0169528", "people",
                          "8706c9b9c83cd14d.json")
    fixed = []
    problems = 0

    # 7.1 人物卡：空偏好 / 空事件 / 重复 id
    try:
        with open(card_p, encoding="utf-8-sig") as f:
            card = json.load(f)
        prefs = card.get("preferences") or []
        events = card.get("events") or []
        empty_pref = [p for p in prefs
                      if not p.get("deleted") and not p.get("superseded") and not str(p.get("text") or "").strip()]
        empty_ev = [e for e in events
                    if not e.get("deleted") and not (str(e.get("summary") or "").strip() or str(e.get("title") or "").strip())]
        ids = [e.get("id") for e in events if e.get("id")]
        dup_ids = len(ids) - len(set(ids))
        if empty_pref:
            problems += len(empty_pref)
            print("  ✗ 空偏好 %d 条" % len(empty_pref))
            if clean:
                for p in empty_pref:
                    p["deleted"] = True
                fixed.append("空偏好 %d" % len(empty_pref))
        if empty_ev:
            problems += len(empty_ev)
            print("  ✗ 空事件 %d 条" % len(empty_ev))
            if clean:
                for e in empty_ev:
                    e["deleted"] = True
                fixed.append("空事件 %d" % len(empty_ev))
        if dup_ids:
            problems += dup_ids
            print("  ✗ 事件 id 重复 %d 个" % dup_ids)
        if clean and (empty_pref or empty_ev):
            with open(card_p, "w", encoding="utf-8", newline="\n") as f:
                json.dump(card, f, ensure_ascii=False, indent=1)
        if not (empty_pref or empty_ev or dup_ids):
            ok("人物卡干净（偏好 %d / 事件 %d）" % (len(prefs), len(events)))
    except Exception as e:
        conflict("脏数据", "人物卡读不了：%r" % e)

    # 7.2 messages.jsonl 坏行
    bad_lines = 0
    for p in glob.glob(os.path.join(ROOT, "data", "memory", "chats", "*", "messages.jsonl")):
        try:
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        json.loads(line)
                    except Exception:
                        bad_lines += 1
        except Exception:
            pass
    if bad_lines:
        problems += bad_lines
        print("  ✗ messages.jsonl 坏行 %d 行" % bad_lines)
        if clean:
            removed = 0
            for p in glob.glob(os.path.join(ROOT, "data", "memory", "chats", "*", "messages.jsonl")):
                try:
                    lines = open(p, encoding="utf-8").read().splitlines()
                    keep = []
                    for line in lines:
                        if not line.strip():
                            continue
                        try:
                            json.loads(line)
                            keep.append(line)
                        except Exception:
                            removed += 1
                    if removed:
                        import shutil as _sh
                        _sh.copy2(p, p + ".bak-dirty")
                        open(p, "w", encoding="utf-8", newline="\n").write("\n".join(keep) + "\n")
                except Exception:
                    pass
            fixed.append("坏行 %d" % removed)
    else:
        ok("messages.jsonl 全部可解析")

    # 7.3 表情索引悬空
    D = os.path.join(ROOT, "data", "stickers", "搜来的")
    U = os.path.join(D, "_usage.json")
    if os.path.exists(U):
        try:
            with open(U, encoding="utf-8-sig") as f:
                usage = json.load(f)
            dangling = [k for k in usage if not os.path.exists(os.path.join(D, k))]
            if dangling:
                problems += len(dangling)
                print("  ✗ 表情索引悬空 %d 条" % len(dangling))
                if clean:
                    for k in dangling:
                        usage.pop(k, None)
                    import shutil as _sh
                    _sh.copy2(U, U + ".bak-dirty")
                    with open(U, "w", encoding="utf-8", newline="\n") as f:
                        json.dump(usage, f, ensure_ascii=False, indent=1)
                    fixed.append("悬空索引 %d" % len(dangling))
            else:
                ok("表情索引无悬空")
        except Exception as e:
            conflict("脏数据", "表情索引读不了：%r" % e)

    # 7.4 mood.json 可解析
    try:
        with open(os.path.join(ROOT, "data", "mood.json"), encoding="utf-8-sig") as f:
            json.load(f)
        ok("mood.json 可解析")
    except FileNotFoundError:
        print("  · 还没有 mood.json（正常）")
    except Exception as e:
        conflict("脏数据", "mood.json 坏了：%r" % e)

    if fixed:
        print("  [已清理] " + "、".join(fixed))
    return problems


def main():
    local = []
    if "--local" in sys.argv:
        i = sys.argv.index("--local")
        local = [a for a in sys.argv[i + 1:] if not a.startswith("--")]
    if local:
        check_local(local)
    else:
        check_rules_vs_code()
        check_config_vs_code()
        check_docs_vs_code()
        check_memory_vs_ledger()
        check_script_refs()
        check_syntax()

    check_dirty("--clean" in sys.argv)

    print("\n" + "=" * 46)
    if not CONFLICTS:
        print("冲突审查：没有发现冲突")
        return 0
    print("冲突审查：发现 %d 处冲突" % len(CONFLICTS))
    for where, msg in CONFLICTS:
        print("  [%s] %s" % (where, msg))
    return 1


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
