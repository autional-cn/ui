#!/usr/bin/env node
// check-lint —— lint 闸门（第 24 道）
//
// 背景（2026-10-04 实测）：四个在册门户的 package.json 里都写着 "lint": "eslint src/"，
// 但**全舰队没有一份 ESLint 配置、也没有任何一处把 eslint 声明成依赖**。
// `pnpm exec eslint` 解析到的是上层目录里别的项目装的那一份（D:\\deepseek-harness\\node_modules\\...），
// 再因为找不到配置而以 2 退出 —— 这条命令从来没在本仓跑过，它只是一个名字。
// 这正是「没有闸门的检查等于没有检查」的最字面版本：**这里连检查都不存在。**
//
// 现在：规则只有一个来源（@autional-cn/eslint-config），站点只留三行 eslint.config.mjs。
// 本闸门做三件事：
//   ① 每个在册门户必须**真的声明** eslint 与共享配置（防止又退回「脚本指向空气」）；
//   ② 跑一遍，**error 必须为 0**；
//   ③ warning 按规则逐项**棘轮**：只许减不许增（台账 verification/lint-baseline.json）。
//      —— 首轮 921 条 warning 里 819 条是 no-explicit-any、328 条里大半是解构剔除，
//         一次性清空不现实；登记制是舰队一路用的办法，比「全红然后大家学会 eslint-disable」诚实。
//
// 用法: node scripts/check-lint.mjs [--write-registry]

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from './lib/tokens.mjs';

const WRITE = process.argv.includes('--write-registry');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const BASELINE = join(ROOT, 'verification', 'lint-baseline.json');

const APPS = [
  { site: 'admin', app: 'apps/admin-console' },
  { site: 'platform', app: 'apps/platform-console' },
  { site: 'security', app: 'apps/security-dashboard' },
  { site: 'user', app: 'apps/end-user-portal' }
];

const problems = [];
const warns = [];
const info = [];
const measured = {};
let errorsTotal = 0;
let warnsTotal = 0;
let checked = 0;

if (!existsSync(SITES)) {
  console.log('check-lint：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

for (const { site, app } of APPS) {
  const dir = join(SITES, site, app);
  const pj = join(dir, 'package.json');
  if (!existsSync(pj) || !existsSync(join(dir, 'node_modules'))) { info.push(site + '：未安装，跳过（非静默通过）'); continue; }
  let manifest;
  try { manifest = JSON.parse(readFileSync(pj, 'utf8')); } catch (e) { problems.push('C14 ' + site + '：package.json 读不动'); continue; }
  const deps = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  if (!manifest.scripts || !manifest.scripts.lint) {
    problems.push('C14 ' + site + '：package.json 里没有 lint 脚本 —— 在册门户必须有一条可执行的 lint');
    continue;
  }
  if (!deps['eslint'] || !deps['@autional-cn/eslint-config']) {
    problems.push('C14 ' + site + '：没有声明 eslint / @autional-cn/eslint-config —— ' +
      '实测过这一种坏法：脚本写着 eslint src/，而 eslint 根本没装，命令从上层目录捡到别的项目的 ESLint 再报「找不到配置」。' +
      '「声明了却跑不了」比「没声明」更糟，因为它看起来是有的。');
    continue;
  }
  if (!existsSync(join(dir, 'eslint.config.mjs')) && !existsSync(join(dir, 'eslint.config.js'))) {
    problems.push('C14 ' + site + '：没有 eslint.config.mjs（flat config）—— 配置也必须只有一个来源：@autional-cn/eslint-config');
    continue;
  }

  const outFile = join(mkdtempSync(join(tmpdir(), 'lint-')), 'report.json');
  const r = spawnSync('pnpm', ['exec', 'eslint', 'src/', '--format', 'json', '-o', outFile], {
    cwd: dir, stdio: 'pipe', shell: process.platform === 'win32', encoding: 'utf8'
  });
  if (!existsSync(outFile)) {
    problems.push('C14 ' + site + '：eslint 没有产出报告（exit=' + r.status + '）—— ' +
      ((r.stderr || r.stdout || '').split('\n').slice(-3).join(' ').slice(0, 200)));
    continue;
  }
  let report;
  try { report = JSON.parse(readFileSync(outFile, 'utf8')); } catch (e) {
    problems.push('C14 ' + site + '：eslint 报告不是合法 JSON');
    continue;
  }
  const counts = {};
  let errs = 0;
  let filesLinted = 0;
  for (const f of report) {
    filesLinted++;
    for (const m of f.messages) {
      const key = m.ruleId || '(fatal)';
      if (m.severity === 2) errs++;
      else counts[key] = (counts[key] || 0) + 1;
    }
  }
  // 自检：一份「零文件」的报告会让这道闸门全绿 —— 与 C8/C9 的度量器自检同一个理由
  if (filesLinted === 0) {
    problems.push('C14 ' + site + '：eslint 报告里 0 个文件 —— 它其实什么都没看（配置路径写错、或 src/ 不存在），这道闸门会假绿');
    continue;
  }
  checked++;
  errorsTotal += errs;
  const warnSum = Object.values(counts).reduce((a, b) => a + b, 0);
  warnsTotal += warnSum;
  measured[site] = counts;
  if (errs > 0) {
    const worst = report.flatMap((f) => f.messages.filter((m) => m.severity === 2)
      .map((m) => f.filePath.split(/[\\/]/).slice(-1)[0] + ':' + m.line + ' ' + (m.ruleId || '') + ' ' + m.message)).slice(0, 6);
    problems.push('C14 ' + site + '：lint 有 ' + errs + ' 条 error（error 必须为 0）：\n      ' + worst.join('\n      '));
  }
  info.push(site + '：' + filesLinted + ' 个文件 · error ' + errs + ' · warning ' + warnSum);
}

if (checked === 0 && APPS.length > 0) {
  problems.push('C14 四个在册门户一个都没查成 —— 这道闸门没生效');
}

if (WRITE) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  const out = {
    $comment: 'lint warning 台账（棘轮，C14）。键 = ESLint 规则名，值 = 该站该规则的 warning 数。只许减不许增；' +
      'error 不在台账里 —— 它必须恒为 0。首轮 921 条 warning 的来源与理由见 @autional-cn/eslint-config/index.js。',
    updated: new Date().toISOString().slice(0, 10),
    apps: {}
  };
  for (const { site } of APPS) out.apps[site] = measured[site] || (prev && prev.apps && prev.apps[site]) || {};
  writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log('已写入 verification/lint-baseline.json（' + Object.keys(measured).length + ' 个站点）');
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  problems.push('C14 verification/lint-baseline.json 缺失 —— lint warning 的存量要靠它记账（node scripts/check-lint.mjs --write-registry）');
} else {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')).apps || {};
  for (const [site, counts] of Object.entries(measured)) {
    const rec = base[site] || {};
    for (const [rule, n] of Object.entries(counts)) {
      const was = rec[rule] || 0;
      if (n > was) problems.push('C14 ' + site + ' 的 lint warning「' + rule + '」从 ' + was + ' 涨到 ' + n +
        ' —— 台账只许减不许增。新增的这类问题要么改掉，要么在评审里说明为什么允许它变多。');
      else if (n < was) warns.push('C14 ' + site + ' 的「' + rule + '」从 ' + was + ' 降到 ' + n + ' —— 这是进展，请跑 node scripts/check-lint.mjs --write-registry 更新台账');
    }
    for (const rule of Object.keys(rec)) {
      if (!(rule in counts) && rec[rule] > 0) warns.push('C14 ' + site + ' 的「' + rule + '」已清零 —— 请跑 --write-registry 把它从台账里去掉');
    }
  }
}

console.log('lint 闸门：' + checked + ' 个在册门户 · error ' + errorsTotal + ' · warning ' + warnsTotal);
for (const l of info) console.log('  [INFO ] ' + l);
for (const l of warns) console.log('  [WARN ] ' + l);
for (const l of problems) console.log('  [ERROR] ' + l);
if (problems.length) { console.log('结论：lint 未通过（' + problems.length + ' 项）'); process.exit(1); }
console.log('结论：lint 通过（error 0；warning 未超过台账）');
