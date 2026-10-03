#!/usr/bin/env node
// 依赖策略闸门（verify 第 19 道）
// 用法: node scripts/check-dep-policy.mjs [--json]
//
// 守两条政策。两条都是 2026-10-03 实测出「不钉住会出事」之后立的：
//
// ① **@autional-cn/\* 的声明必须精确**，不得有 ^ / ~ / workspace:
//    理由不是洁癖，是产品要求：一致性。caret（^0.1.0-rc.2）允许 >=rc.2 <0.2.0 ——
//    也就是**「两个门户跑不同版本的组件库」是一个合法状态**。而"这些 portal 看起来
//    像同一家公司的同一个产品"正是本项目的目标；把它的反面写进 package.json 是自相矛盾。
//    实测到的具体危害：admin 精确停在 ui rc.2，而新发布的 rc.3 会被 caret 的站在
//    下一次安装时自动拿到 —— 「声明的版本」与「实际装的版本」变成两个来源。
//
// ② **部署安装必须冻结**：vercel.json 的 installCommand 必须含 --frozen-lockfile
//    实测：14 个站里 13 个写的是 "pnpm install"（非 frozen），只有 web 用了冻结。
//    非 frozen 的 install 在 package.json 与 lockfile 不一致时会**静默解析**成别的东西，
//    而冻结安装会**失败**。发布这件事上，失败比静默正确。
//
// 两条必须一起守：只做①则非 frozen 安装仍可能漂；只做②则 package.json 与 lockfile
// 仍是同一个事实的两个来源。这条纪律舰队已经反复付过学费
// （theme_color、CDN 版本、tokens.json 的 schema 版本 vs npm 包版本，都是同一句话）。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const problems = [];
const infos = [];
const rows = [];

if (!existsSync(SITES)) {
  console.log('check-dep-policy：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const manifests = (siteDir) => {
  const out = [];
  const p = join(siteDir, 'package.json');
  if (existsSync(p)) out.push(p);
  const apps = join(siteDir, 'apps');
  if (existsSync(apps)) for (const a of readdirSync(apps)) {
    const q = join(apps, a, 'package.json');
    if (existsSync(q)) out.push(q);
  }
  return out;
};

for (const site of readdirSync(SITES).sort()) {
  const siteDir = join(SITES, site);
  if (!statSync(siteDir).isDirectory()) continue;

  let checked = 0, loose = 0, frozenOk = null;

  for (const mf of manifests(siteDir)) {
    let j; try { j = JSON.parse(readFileSync(mf, 'utf8')); } catch (e) { problems.push('P0 ' + site + '：' + relative(SITES, mf) + ' 不是合法 JSON'); continue; }
    for (const sec of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (!j[sec]) continue;
      for (const [name, spec] of Object.entries(j[sec])) {
        if (name.indexOf('@autional-cn/') !== 0) continue;
        checked++;
        if (/^[\^~]/.test(spec) || spec.indexOf('workspace:') === 0) {
          loose++;
          problems.push('P1 ' + site + '：' + relative(SITES, mf) + ' 的 ' + name + ' 声明为 "' + spec +
            '" —— 必须是**精确版本**。区间会让「两站跑不同版本的组件库」成为合法状态，而一致性正是本项目的产品要求');
        }
      }
    }
  }

  const vj = join(siteDir, 'vercel.json');
  if (existsSync(vj)) {
    try {
      const j = JSON.parse(readFileSync(vj, 'utf8'));
      const ic = j.installCommand || '';
      frozenOk = ic.indexOf('--frozen-lockfile') >= 0;
      if (!frozenOk) {
        problems.push('P2 ' + site + '：vercel.json 的 installCommand = "' + (ic || '(未设置)') +
          '" —— 缺 --frozen-lockfile。非冻结安装会在 package.json 与 lockfile 不一致时静默解析成别的东西；冻结安装会失败。发布这件事上，失败比静默正确');
      }
    } catch (e) {
      problems.push('P2 ' + site + '：vercel.json 不是合法 JSON');
    }
  } else {
    infos.push('P2 ' + site + '：没有 vercel.json —— 本站不经过 Vercel 构建，跳过部署安装断言');
  }

  if (checked || frozenOk !== null) rows.push({ site, deps: checked, loose, frozen: frozenOk === null ? '—' : (frozenOk ? 'Y' : 'N') });
}

if (AS_JSON) console.log(JSON.stringify({ rows, infos, problems }, null, 2));
else {
  console.log('依赖策略闸门：' + rows.length + ' 个站点');
  console.log('');
  console.log('  站点'.padEnd(17) + 'DS 依赖  精确  vercel 冻结');
  for (const r of rows) console.log('  ' + r.site.padEnd(15) + String(r.deps).padStart(6) + String(r.loose === 0 ? 'Y' : 'N').padStart(6) + String(r.frozen).padStart(12));
  console.log('');
  for (const i of infos) console.log('  [INFO ] ' + i);
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length ? '结论：有 ' + problems.length + ' 项不达标' : '结论：全部站点的依赖声明精确、部署安装冻结（' + rows.length + ' 站）');
}
process.exit(problems.length ? 1 : 0);
