# -*- coding: utf-8 -*-
"""真实重复消息必须回复；只挡同一消息 id 重投。"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bridge'))
import guards  # noqa: E402


class DuplicateGuardTests(unittest.TestCase):
    def setUp(self):
        guards._recent_dup.clear()

    def test_same_text_different_ids_are_replied(self):
        self.assertFalse(guards.duplicate_guard('chat', 'sender', '你会不会舍不得扔', 'm1'))
        self.assertFalse(guards.duplicate_guard('chat', 'sender', '你会不会舍不得扔', 'm2'))
        self.assertFalse(guards.duplicate_guard('chat', 'sender', '你会不会舍不得扔', 'm3'))

    def test_same_id_redelivery_is_suppressed(self):
        self.assertFalse(guards.duplicate_guard('chat', 'sender', '同一句', 'm1'))
        self.assertTrue(guards.duplicate_guard('chat', 'sender', '同一句', 'm1'))

    def test_missing_id_is_not_silently_dropped(self):
        self.assertFalse(guards.duplicate_guard('chat', 'sender', '同一句', ''))
        self.assertFalse(guards.duplicate_guard('chat', 'sender', '同一句', ''))


if __name__ == '__main__':
    unittest.main(verbosity=2)
