#!/usr/bin/env node
// 发布一致性闸门（verify 第 16 道）
//
// 设计系统的产物有**三个交付面**，它们都应当由同一份 SSOT 派生：
//   ① npm 包（@autional-cn/*）—— 构建期代码
//   ② CDN（cdn.autional.cn/ui/v<版本>/）—— 运行期资产
//   ③ 站点内的 vendored 副本 —— 回滚通道
//
// ② 和 ③ 各有一道闸门守着（第 8 道 CDN 资产契约含「与 SSOT 一致」；第 4 道消费者副本漂移）。
// 但 ① 在此之前**没有任何检查** —— 也就是说：改了令牌、只发了 CDN、忘了发 npm，
// 而 15 道闸门会全绿。这与第 24 轮发现的 CDN 缺口是同一类问题，只是发生在另一个交付面。
//
// 做法的就是「生成物一致性」的发布版：把一个**不带凭据**的干净安装拉到临时目录，
// 与本地产物逐文件比 sha256。用干净安装而非读 registry 元数据，是因为前者顺带验证了
// 「消费者真的能装上」——那才是 P4 依赖的条件。
//
// 用法: node scripts/check-publish.mjs [--json]

import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const problems = [];
const infos = [];

// 发布出去的包 → 与本地哪个产物对应。只列会被消费方真正使用的文件。
const PAIRS = [
  ['@autional-cn/tokens', 'tokens.css',                      'packages/tokens/tokens.css'],
  ['@autional-cn/tokens', 'primitives.css',                  'packages/tokens/primitives.css'],
  ['@autional-cn/tokens', 'dist/index.js',                   'packages/tokens/dist/index.js'],
  ['@autional-cn/tokens', 'dist/index.d.ts',                 'packages/tokens/dist/index.d.ts'],
  ['@autional-cn/tokens', 'dist/tokens.json',                'packages/tokens/dist/tokens.json'],
  ['@autional-cn/tokens', 'dist/chart.js',                   'packages/tokens/dist/chart.js'],
  ['@autional-cn/tokens', 'dist/antd-theme.mjs',             'packages/tokens/dist/antd-theme.mjs'],
  ['@autional-cn/tokens', 'profiles/docs.css',               'packages/tokens/profiles/docs.css'],
  ['@autional-cn/tokens', 'profiles/developer.css',          'packages/tokens/profiles/developer.css'],
  ['@autional-cn/tokens', 'fonts/inter-latin-wght-normal.woff2', 'packages/tokens/fonts/inter-latin-wght-normal.woff2'],
  ['@autional-cn/tailwind-preset', 'index.js',               'packages/tailwind-preset/index.js'],
  ['@autional-cn/tailwind-preset', 'index.d.ts',             'packages/tailwind-preset/index.d.ts'],
];

const version = JSON.parse(readFileSync(join(ROOT, 'packages', 'tokens', 'package.json'), 'utf8')).version;
const pkgs = [...new Set(PAIRS.map((p) => p[0]))];

const tmp = mkdtempSync(join(tmpdir(), 'publish-freshness-'));
try {
  // 刻意**不带凭据**：这正是 14 个 Vercel 项目构建时的条件。
  const env = { ...process.env };
  delete env.NPM_CONFIG_USERCONFIG;
  delete env.NODE_AUTH_TOKEN;
  execFileSync('npm', ['init', '-y'], { cwd: tmp, stdio: 'pipe', shell: process.platform === 'win32' });
  execFileSync('npm', ['install', ...pkgs.map((p) => p + '@' + version)], { cwd: tmp, stdio: 'pipe', env, shell: process.platform === 'win32' });

  const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12);
  let same = 0;
  for (const [pkg, rel, localRel] of PAIRS) {
    const installed = join(tmp, 'node_modules', ...pkg.split('/'), rel);
    const local = join(ROOT, localRel);
    if (!existsSync(local)) { problems.push('本地产物缺失：' + localRel); continue; }
    if (!existsSync(installed)) { problems.push('包 ' + pkg + ' 里没有 ' + rel + '（本地有）'); continue; }
    if (sha(installed) !== sha(local)) {
      problems.push('npm 上的 ' + pkg + '@' + version + ' 的 ' + rel + ' 与当前 SSOT 不一致（包 ' + sha(installed) + ' vs 本地 ' + sha(local) + '）');
    } else same++;
  }
  infos.push('已发布内容与当前 SSOT：' + same + '/' + PAIRS.length + ' 个文件逐字节一致（按 @' + version + ' 无凭据安装核验）');

  // 版本号本身也要对得上
  for (const pkg of pkgs) {
    const pj = join(tmp, 'node_modules', ...pkg.split('/'), 'package.json');
    const v = JSON.parse(readFileSync(pj, 'utf8')).version;
    if (v !== version) problems.push(pkg + ' 已发布的版本是 ' + v + '，而本地是 ' + version);
  }
  if (problems.length) {
    problems.push('重新发布：cd ui && pnpm -r publish --access public --tag rc（预发版必须带 --tag）');
  }
} catch (e) {
  const msg = String((e && e.message) || e);
  // 区分「连不上 registry」与「连上了但内容不对」——前者是环境条件，后者是缺陷。
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|network|EAI_AGAIN/i.test(msg)) {
    infos.push('SKIP —— 无法访问 registry（' + msg.split('\n')[0].slice(0, 90) + '）。这不是通过，是没验。');
  } else {
    problems.push('核验失败：' + msg.split('\n').slice(0, 3).join(' / '));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (AS_JSON) console.log(JSON.stringify({ version, infos, problems }, null, 2));
else {
  console.log('发布一致性闸门：@autional-cn/* 本地版本 ' + version);
  for (const i of infos) console.log('  [INFO ] ' + i);
  for (const p of problems) console.log('  [ERROR] ' + p);
  const skipped = infos.some((i) => i.indexOf('SKIP') >= 0);
  console.log(problems.length ? '结论：发布一致性有 ' + problems.length + ' 项不达标'
    : (skipped ? '结论：本地通过；registry 核验被跳过（不要当成已验）' : '结论：npm 与当前 SSOT 一致'));
}
process.exit(problems.length ? 1 : 0);
