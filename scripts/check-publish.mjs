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

// 目录级比对：整包逐文件比，而不是手写清单。
// 为什么加（2026-09 轮次 47）：组件库 @autional-cn/ui 是在轮次 45 才发布的，
// 而 PAIRS 是手列的 —— 于是它**发布之后没有任何闸门在看**：改了 ui/packages/ui 的源码、
// 忘了重新发布，17 道门照样全绿，而 9 个站点拿到的还是旧包。
// 组件库有 20+ 个源文件，手列一份清单必然随文件增删而腐烂，所以这一条直接走目录。
const DIR_PAIRS = [
  ['@autional-cn/ui', 'packages/ui/src'],
  ['@autional-cn/shared', 'packages/shared/src'],
  ['@autional-cn/react', 'packages/react/src'],
];

// 每个包读**自己**的版本。原来是一把尺子量所有包（统一取 tokens 的版本），
// 在 shared 需要单独升版（0.1.0-rc.1）时就会直接报错——包本来就该各自有版本。
const PKG_DIR = {
  '@autional-cn/tokens': 'packages/tokens',
  '@autional-cn/tailwind-preset': 'packages/tailwind-preset',
  '@autional-cn/ui': 'packages/ui',
  '@autional-cn/shared': 'packages/shared',
  '@autional-cn/react': 'packages/react'
};
const versionOf = (pkg) => JSON.parse(readFileSync(join(ROOT, PKG_DIR[pkg], 'package.json'), 'utf8')).version;
const pkgs = [...new Set(PAIRS.map((p) => p[0]).concat(DIR_PAIRS.map((p) => p[0])))];

const tmp = mkdtempSync(join(tmpdir(), 'publish-freshness-'));
try {
  // 刻意**不带凭据**：这正是 14 个 Vercel 项目构建时的条件。
  //
  // registry 必须显式钉死：删掉 NPM_CONFIG_USERCONFIG 只是让 npm 回到默认位置，
  // 而默认位置就是 ~/.npmrc —— 本机那份把 registry 指向 npmmirror。闸门在临时目录里跑，
  // ui/.npmrc 的 @autional-cn:registry 作用不到，于是刚发布的版本在镜像站同步前必然 ETARGET
  // （实测：shared@0.1.0-rc.10 已在 npmjs 可下载，闸门仍报 no matching version）。
  const env = { ...process.env };
  delete env.NPM_CONFIG_USERCONFIG;
  delete env.NODE_AUTH_TOKEN;
  const REG = '--registry=https://registry.npmjs.org/';
  execFileSync('npm', ['init', '-y', REG], { cwd: tmp, stdio: 'pipe', shell: process.platform === 'win32' });
  execFileSync('npm', ['install', REG, ...pkgs.map((p) => p + '@' + versionOf(p))], { cwd: tmp, stdio: 'pipe', env, shell: process.platform === 'win32' });

  const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 12);
  const walk = (d, base, out) => {
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, base, out);
      else out.push(p.slice(base.length + 1).replace(/\\/g, '/'));
    }
    return out;
  };
  let same = 0;
  let total = PAIRS.length;
  for (const [pkg, rel, localRel] of PAIRS) {
    const installed = join(tmp, 'node_modules', ...pkg.split('/'), rel);
    const local = join(ROOT, localRel);
    if (!existsSync(local)) { problems.push('本地产物缺失：' + localRel); continue; }
    if (!existsSync(installed)) { problems.push('包 ' + pkg + ' 里没有 ' + rel + '（本地有）'); continue; }
    if (sha(installed) !== sha(local)) {
      problems.push('npm 上的 ' + pkg + '@' + versionOf(pkg) + ' 的 ' + rel + ' 与当前 SSOT 不一致（包 ' + sha(installed) + ' vs 本地 ' + sha(local) + '）');
    } else same++;
  }
  for (const [pkg, localDirRel] of DIR_PAIRS) {
    const localDir = join(ROOT, localDirRel);
    const pkgRoot = join(tmp, 'node_modules', ...pkg.split('/'));
    if (!existsSync(localDir)) { problems.push('本地目录缺失：' + localDirRel); continue; }
    // 测试文件是**刻意不发**的（packages/ui/package.json 的 files 里有 "!src/test" / "!src/__tests__"），
    // 拿它们比会得到两条假阳性。判据要跟着「发布口径」走，不是跟着目录里有什么走。
    const files = walk(localDir, localDir, []).filter((f) => !/^(test|__tests__)\//.test(f));
    let dirSame = 0;
    for (const rel of files) {
      total++;
      const installed = join(pkgRoot, localDirRel.split('/').pop(), rel);
      const local = join(localDir, rel);
      if (!existsSync(installed)) { problems.push('包 ' + pkg + ' 里没有 ' + rel + '（本地有）——该文件是发布之后新加的，需要重新发布'); continue; }
      if (sha(installed) !== sha(local)) {
        problems.push('npm 上的 ' + pkg + '@' + versionOf(pkg) + ' 的 ' + rel + ' 与当前 SSOT 不一致（包 ' + sha(installed) + ' vs 本地 ' + sha(local) + '）——改了源码就要重新发布');
      } else dirSame++;
    }
    infos.push('目录比对 ' + pkg + ' · ' + localDirRel + '：' + dirSame + '/' + files.length + ' 个文件逐字节一致');
  }
  infos.push('已发布内容与当前 SSOT：' + same + '/' + total + ' 个文件逐字节一致（按各自本地版本无凭据安装核验）');

  // 版本号本身也要对得上
  for (const pkg of pkgs) {
    const pj = join(tmp, 'node_modules', ...pkg.split('/'), 'package.json');
    const v = JSON.parse(readFileSync(pj, 'utf8')).version;
    const want = versionOf(pkg);
    if (v !== want) problems.push(pkg + ' 已发布的版本是 ' + v + '，而本地是 ' + want);
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

if (AS_JSON) console.log(JSON.stringify({ versions: Object.fromEntries(pkgs.map((p) => [p, versionOf(p)])), infos, problems }, null, 2));
else {
  console.log('发布一致性闸门：' + pkgs.map((p) => p.replace('@autional-cn/', '') + '@' + versionOf(p)).join('  '));
  for (const i of infos) console.log('  [INFO ] ' + i);
  for (const p of problems) console.log('  [ERROR] ' + p);
  const skipped = infos.some((i) => i.indexOf('SKIP') >= 0);
  console.log(problems.length ? '结论：发布一致性有 ' + problems.length + ' 项不达标'
    : (skipped ? '结论：本地通过；registry 核验被跳过（不要当成已验）' : '结论：npm 与当前 SSOT 一致'));
}
process.exit(problems.length ? 1 : 0);
