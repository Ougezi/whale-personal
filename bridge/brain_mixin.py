# -*- coding: utf-8 -*-
"""把 BrainAgent 接进桥接：初始化、发送、结果入记忆。"""
import engine as G


class BrainMixin:
    def init_brain(self):
        if getattr(self, 'brain', None) is not None:
            return
        try:
            import brain_agent
            self.brain = brain_agent.BrainAgent(
                send=self._brain_send,
                record=self._brain_record,
                log=G.log,
            )
            self.brain.master = str(getattr(G, 'MASTER_WXID', '') or '')
            self.brain.start_watch()
            if not self.brain.master:
                G.log_warn('执行脑：没有识别到主人 wxid，脑子命令不会被触发')
            else:
                G.log('执行脑已就绪（脑子：/脑子写：/脑子状态）')
        except Exception as e:
            self.brain = None
            G.log('执行脑初始化失败（不影响聊天）：', repr(e))

    def _brain_send(self, text, chat):
        try:
            name = self.display_name(chat) if hasattr(self, 'display_name') else chat
            return self.send_text(str(text or ''), name, chat)
        except Exception as e:
            G.log('执行脑发送失败：', repr(e))
            return False

    def _brain_record(self, payload):
        try:
            base = self.bot_url.rsplit('/webhook', 1)[0]
            headers = {'x-whale-bridge': '1', 'x-whale-bridge-token': self.token or ''}
            return G.LOCAL_HTTP.post(base + '/api/memory/brain', json=payload, headers=headers, timeout=10)
        except Exception as e:
            G.log('执行脑结果入记忆失败：', repr(e))
            return None
