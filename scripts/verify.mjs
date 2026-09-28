#!/usr/bin/env node
// verify — 一条命令跑完 ui/ 的全部校验，任一失败即退出码 1
// 用法: node scripts/verify.mjs
//
// 分工：
//   gen:check   产物是否与 tokens/tokens.json 一致（新鲜度）
//   lint-tokens SSOT 的值本身是否正确 / 有无冲突 / 是否满足对比度契约
//   token-lock  SSOT 是否被改动过（改动必须登记）
// 三者互补：只跑其中任何一个都会留下盲区。

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/tokens.mjs';

const STEPS = [
  { key: 'gen', label: '生成物一致性', cmd: ['node', 'scripts/generate.mjs', '--check'] },
  { key: 'lint', label: '令牌 lint', cmd: ['node', 'scripts/lint-tokens.mjs'] },
  { key: 'lock', label: '令牌快照锁', cmd: ['node', 'scripts/token-lock.mjs', '--check'] },
  { key: 'consumers', label: '消费者副本漂移', cmd: ['node', 'scripts/check-consumers.mjs'] },
  { key: 'assets', label: '字体资产台账 + 字体加载断言', cmd: ['node', 'scripts/check-assets.mjs'] },
  { key: 'typography', label: '排版令牌落地（发布 CSS + 消费方编译产物）', cmd: ['node', 'scripts/check-typography.mjs'] },
  { key: 'chart', label: '图表色板（非文本对比度 + 正常/红绿色盲可区分性）', cmd: ['node', 'scripts/check-chart-palette.mjs'] },
  { key: 'cdn', label: 'CDN 资产契约（CORS / 不可变缓存 / manifest 字节一致）', cmd: ['node', 'scripts/check-cdn.mjs'] },
  { key: 'consistency', label: '跨 portal 视觉一致性（antd 主题 / 硬编码色 / 组件库份数 / 令牌覆盖）', cmd: ['node', 'scripts/check-consistency.mjs'] },
  { key: 'visual', label: '站点视觉回归（无产物/无浏览器时自动跳过）', cmd: ['node', 'scripts/visual.mjs', 'check'] }
];

const results = [];
for (const step of STEPS) {
  console.log('');
  console.log('── ' + step.label + ' (' + step.cmd.slice(1).join(' ') + ') ' + '─'.repeat(Math.max(0, 40 - step.label.length)));
  const r = spawnSync(step.cmd[0], step.cmd.slice(1), { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  results.push({ step, status: r.status });
}

const failed = results.filter((r) => r.status !== 0);
console.log('');
console.log('════════ 汇总 ════════');
for (const r of results) console.log('  ' + (r.status === 0 ? 'PASS' : 'FAIL') + '  ' + r.step.label);
if (failed.length === 0) {
  console.log('结论：全部通过（' + results.length + ' 项）');
  process.exit(0);
}
console.log('结论：' + failed.length + '/' + results.length + ' 项失败：' + failed.map((r) => r.step.label).join(', '));
process.exit(1);
