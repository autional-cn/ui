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
  { key: 'colors', label: '非设计系统色值（是否在重复发明已有令牌）', cmd: ['node', 'scripts/check-colors.mjs'] },
  { key: 'icons', label: '图标套件（声明完整 / 文件存在 / theme-color 单源 / 不漂移）', cmd: ['node', 'scripts/check-icons.mjs'] },
  { key: 'headers', label: '顶栏契约（高度令牌驱动 / position / 品牌标）', cmd: ['node', 'scripts/check-headers.mjs'] },
  { key: 'capabilities', label: '预设能力契约（模板用了需要插件的类，插件是否真的在）', cmd: ['node', 'scripts/check-preset-capabilities.mjs'] },
  { key: 'classnames', label: '类名可达性（裸色阶类名写了但生成不出来）', cmd: ['node', 'scripts/check-classnames.mjs'] },
  { key: 'publish', label: '发布一致性（npm 已发布内容是否仍等于当前 SSOT）', cmd: ['node', 'scripts/check-publish.mjs'] },
  { key: 'non-tenant', label: '业务路由名单（各 portal 注册的非租户首段 vs 自己的路由表）', cmd: ['node', 'scripts/check-non-tenant.mjs'] },
  { key: 'consistency', label: '跨 portal 视觉一致性（antd 主题 / 硬编码色 / 组件库份数 / 令牌覆盖）', cmd: ['node', 'scripts/check-consistency.mjs'] },
  { key: 'visual', label: '站点视觉回归（无产物/无浏览器时自动跳过）', cmd: ['node', 'scripts/visual.mjs', 'check'] },
  { key: 'contrast', label: '对比度 AA（真实页面渲染出来的前景/背景）', cmd: ['node', 'scripts/check-contrast.mjs'] }
];

// ── --except：发布流程需要一次「发之前」的全量校验 ──────────────────────────
// 闸门 publish 断言「npm 上已发布的版本 == 本地 SSOT」。发布**之前**它按定义必然为红
// —— 那正是发布要做的事。所以发版流程需要一个"除它以外全跑"的入口。
//
// 但一个通用的 --skip 开关迟早会长成绕闸门的后门。所以允许清单**写死在代码里**，
// 且只允许一个键；输出里显式打印 EXCLUDED 一行，汇总里也标注。
// publish 必须在发布之后补跑（release.yml 的后置步骤），不是可以不跑。
//
// 允许清单恰好两项，理由都是同一类：它们断言的是**交付面与 SSOT 同步**，
// 而发版流程要做的正是"让它们同步"，所以在同步之前它们按定义必然为红。
//   publish —— npm 上已发布的 == 本地 SSOT
//   cdn     —— cdn 工作区的产物 == 本地 SSOT
// 两项都在发布之后补跑（见 release.yml 的后置门）。其余 16 项在发布前必须全绿。
const EXCEPT_ALLOWED = new Set(['publish', 'cdn']);
const exceptIdx = process.argv.indexOf('--except');
const EXCEPT = exceptIdx >= 0
  ? String(process.argv[exceptIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)
  : [];
for (const k of EXCEPT) {
  if (!EXCEPT_ALLOWED.has(k)) {
    console.error('--except 只允许排除 ' + [...EXCEPT_ALLOWED].join(' / ') + '，收到：' + k);
    console.error('这不是"跳过闸门"的通用开关：闸门失败要修，不要豁免。');
    process.exit(2);
  }
}
const RUN = STEPS.filter((s) => !EXCEPT.includes(s.key));
if (EXCEPT.length) {
  console.log('⚠️  EXCLUDED：' + EXCEPT.join(', ') + ' —— 本次不跑，发布后必须补跑（见 .github/workflows/release.yml）');
}

const results = [];
for (const step of RUN) {
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
  console.log('结论：全部通过（' + results.length + ' 项' + (EXCEPT.length ? '；另有 ' + EXCEPT.length + ' 项被 EXCLUDED，未验' : '') + '）');
  process.exit(0);
}
console.log('结论：' + failed.length + '/' + results.length + ' 项失败：' + failed.map((r) => r.step.label).join(', '));
process.exit(1);
