# -*- coding: utf-8 -*-
"""出生技能 · 三技能启用配置（B7-01）。

生长 / 说话 / 动手可独立开关；宪法只读，永远不可关。
默认安全：说话+记忆（动手）开，生长默认关，主人可单独开。
"""
import json
import os
import tempfile

SKILLS = ('grow', 'chat', 'dsh')
LABELS = {'grow': '生长', 'chat': '说话', 'dsh': '动手'}
DEFAULTS = {'grow': False, 'chat': True, 'dsh': True}
CONSTITUTION_READONLY = True


class BirthConfigError(Exception):
    pass


class BirthConfig:
    def __init__(self, skills=None):
        self.skills = dict(DEFAULTS)
        if skills:
            for k, v in skills.items():
                if k not in SKILLS:
                    raise BirthConfigError('unknown skill: ' + str(k))
                self.skills[k] = bool(v)
        self.constitution = {'readonly': CONSTITUTION_READONLY}

    def set_skill(self, name, enabled):
        if name not in SKILLS:
            raise BirthConfigError('unknown skill: ' + str(name))
        self.skills[name] = bool(enabled)
        return self.snapshot()

    def enable_all(self):
        for k in SKILLS:
            self.skills[k] = True
        return self.snapshot()

    def disable_all(self):
        for k in SKILLS:
            self.skills[k] = False
        return self.snapshot()

    def try_disable_constitution(self):
        raise BirthConfigError('constitution is readonly')

    def snapshot(self):
        return {'skills': dict(self.skills), 'constitution': dict(self.constitution),
                'enabled': [k for k in SKILLS if self.skills[k]]}

    def save(self, path):
        data = self.snapshot()
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix='birth-config-', dir=os.path.dirname(path) or '.')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return data

    @classmethod
    def load(cls, path):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        cfg = cls(data.get('skills'))
        if (data.get('constitution') or {}).get('readonly') is not True:
            raise BirthConfigError('constitution must stay readonly')
        return cfg
