// 记忆写入探针（2026-11-24）：离线验证 recordUser/recordAssistant 两个入口
// 用法：node scripts/tools/memory-probe.js [--json]
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { Store } = require(path.join(ROOT, 'src', 'memory', 'store.js'));

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-probe-'));
  const store = new Store({
    file: path.join(dir, 'store.json'),
    dir: path.join(dir, 'memory'),
    config: { paths: { dataDir: dir }, persona: { master: { wxids: ['probe_master'], names: ['主人'] } } },
    logger: null,
  });
  const key = 'wechat:u:probe_master';
  const msg = { platform: 'wechat', chatType: 'private', chatId: 'probe_master', senderId: 'probe_master', senderName: '主人' };
  store.recordUser(key, msg, '我喜欢橘子，以后叫我小橘');
  store.recordAssistant(key, { name: '鲸鲸', text: '探针回复：好，小橘' });
  const rows = store.messages(key, 5);
  const user = rows.find((r) => r.role === 'user');
  const reply = rows.find((r) => r.role === 'assistant');
  const checks = {
    userStored: Boolean(user && String(user.text).includes('橘子')),
    userIsMaster: Boolean(user && user.isMaster === true),
    assistantStored: Boolean(reply && String(reply.text).includes('小橘')),
    noWriteFailures: store.writeFailures.total === 0,
    auditWritten: fs.existsSync(path.join(dir, 'memory', 'audit.jsonl')),
  };
  const ok = Object.values(checks).every(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok, checks };
}

const result = run();
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 1));
else {
  console.log('记忆写入探针：' + (result.ok ? '通过' : '失败'));
  for (const [k, v] of Object.entries(result.checks)) console.log((v ? '  ✓ ' : '  ✗ ') + k);
}
process.exit(result.ok ? 0 : 1);
