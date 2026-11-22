# -*- coding: utf-8 -*-
"""任务可行性判断：派活前让模型想一下「执行端到底能不能做」。

为什么不用正则：正则只能覆盖已知的几类（GUI/账号），新花样的活会漏。
模型判断能覆盖未知，但**不能让它随便放行**——所以只问「能不能」，
不能就拦，主人坚持（「试一下」）才真跑。

成本：一条 flash 调用，输入约 150 token，输出 JSON 一行。结果按任务文本缓存。
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CACHE = {}
_MAX_CACHE = 200

SYS = """你是「能力判定器」。一个执行端只能做这些：
- 读本机文件、写本机文件、运行本机命令（PowerShell/Python）
- 发 HTTP 请求查资料

它做不到这些：
- 操作图形界面：点鼠标、敲键盘、点微信/浏览器/软件里的按钮菜单
- 看屏幕、截图、录屏
- 登录账号、扫码、输验证码、过人脸/指纹
- 操作微信或其他应用里的设置开关
- 实时与人对话、打电话、发短信

给你一条任务，判断这个执行端能不能完成。只输出一行 JSON，不要解释、不要代码块：
{"can": true 或 false, "why": "一句话原因（20 字内）", "hint": "给主人的替代做法（20 字内）"}

注意：
1) 改代码、改配置、查文件、跑命令、查资料、分析数据，都算 can=true。
2) 只是任务里**提到**微信/图片也算 true，除非它真的要操作界面或账号。
3) 任务结果会由桥接自动转交给主人——所以「写/整理后发给我」「发个报告给主人」这类
   算 can=true：执行端只要**产出内容**，不需要真的发微信。"""


def _api_key():
    try:
        with open(os.path.join(ROOT, "data", "settings.json"), encoding="utf-8-sig") as f:
            st = json.load(f)
        return str(st.get("apiKey") or ""), str(st.get("baseUrl") or "https://api.deepseek.com")
    except Exception:
        return "", "https://api.deepseek.com"


def _parse(text):
    t = str(text or "").strip()
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    m = re.search(r"\{.*\}", t, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except Exception:
        return None
    if "can" not in d:
        return None
    return {
        "can": bool(d.get("can")),
        "why": str(d.get("why") or "")[:40],
        "hint": str(d.get("hint") or "")[:40],
    }


def judge(task, timeout=8):
    """返回 {can, why, hint}；模型不可用时返回 None（调用方回退到正则）。"""
    t = str(task or "").strip()
    if not t:
        return {"can": False, "why": "任务是空的", "hint": ""}
    key = t[:200]
    if key in _CACHE:
        return _CACHE[key]
    key_api, base = _api_key()
    if not key_api:
        return None
    try:
        body = json.dumps({
            "model": "deepseek-flash",
            "messages": [{"role": "system", "content": SYS},
                         {"role": "user", "content": t[:400]}],
            "max_tokens": 120,
            "temperature": 0,
            "thinking": {"type": "disabled"},
        }).encode("utf-8")
        req = urllib.request.Request(
            base.rstrip("/") + "/chat/completions", data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + key_api})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
        out = _parse(data["choices"][0]["message"]["content"])
        if out is None:
            return None
        if len(_CACHE) > _MAX_CACHE:
            _CACHE.clear()
        _CACHE[key] = out
        return out
    except Exception:
        return None
