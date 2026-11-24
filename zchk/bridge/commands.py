# -*- coding: utf-8 -*-
"""主人命令的正则集中处（2026-11 拆分自 receiver_mixin）。

放在这里的好处：改命令词只动一个文件，自测也能直接测它。
"""
import re

CANCEL = re.compile(r"^(停掉委托|取消委托|取消那个活|停止委托|别跑了|停下)[。！!.]?$")
STATUS = re.compile(r"(几个|多少).*(在跑|委托)|委托.*(状态|进度|还在跑)")
TRY = re.compile(r"^(试一下|试试|试试吧|我要求你试|强行试|硬试)[。！!.]?$")
CONTINUE = re.compile(r"^(继续|接着|继续做|继续弄|往下做|接着弄|一步步弄下去|继续一步步弄下去)[。！!.]?$")
DIRECT = re.compile(r"^(直接做|直接跑|一次做完|别拆了?|跑吧|全都做|一起做)[。！!.]?$")


def kind(text):
    """返回 cancel / status / try / continue / direct，认不出返回空串。"""
    t = str(text or "").strip()
    for name, pat in (("try", TRY), ("direct", DIRECT), ("continue", CONTINUE),
                      ("cancel", CANCEL), ("status", STATUS)):
        if pat.search(t):
            return name
    return ""
