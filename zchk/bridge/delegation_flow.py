# -*- coding: utf-8 -*-
"""委托的状态容器（2026-11 拆自 receiver_mixin）。

四张表：
    _pending_tasks  被拆分闸门拦下、等「直接做」的任务
    _blocked_tasks  被能力闸门拦下、等「试一下」的任务
    _paused_chats   卡住暂停中的会话
    _continue_flag  「继续」信号（跨线程）
    _last_tasks     上一次委托（「继续」用）
"""

TTL_PENDING = 900     # 15 分钟
TTL_BLOCKED = 900
TTL_LAST = 3600       # 1 小时


def ensure(bot):
    """惰性初始化：所有表都在这里建，调用方不用各写 hasattr。"""
    for attr, factory in (("_pending_tasks", dict), ("_blocked_tasks", dict),
                          ("_paused_chats", set), ("_continue_flag", dict),
                          ("_last_tasks", dict)):
        if not hasattr(bot, attr):
            setattr(bot, attr, factory())
    return bot


def remember(table, chat, task, now):
    table[chat] = (task, now)


def take(table, chat, ttl, now):
    """取出且删除；过期返回 None（不会误跑陈年旧活）。"""
    item = table.get(chat)
    if not item:
        return None
    if (now - item[1]) > ttl:
        table.pop(chat, None)
        return None
    table.pop(chat, None)
    return item[0]


def clear(table, chat):
    table.pop(chat, None)


def paused(bot, chat):
    return chat in (getattr(bot, "_paused_chats", set()) or set())


def pause(bot, chat):
    ensure(bot)
    bot._paused_chats.add(chat)


def resume(bot, chat):
    try:
        bot._paused_chats.discard(chat)
    except Exception:
        pass
    try:
        bot._continue_flag[chat] = True
    except Exception:
        pass


def clear_pause(bot, chat):
    try:
        bot._paused_chats.discard(chat)
        bot._continue_flag.pop(chat, None)
    except Exception:
        pass
