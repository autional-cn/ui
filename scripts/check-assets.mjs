#!/usr/bin/env node
// check-assets — 字体资产层：把「用 Inter」从一句声明变成可核对的交付事实
// 用法: node scripts/check-assets.mjs
//
// 背景（实测）：ASTRYX_MANIFEST.brandCore.fontRoleNotes 写着
// 「Latin is self-hosted Inter (@fontsource)」，但：
//   ui/package.json 的 dependencies 是空的，仓库内 @font-face 声明为 0；
//   18 个站点里只有 2 个（reference / wiki）真的装了 @fontsource/inter。
// 也就是说大多数消费方声明的是一款它们并不交付的字体，浏览器直接回退到系统字体。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, loadTokens, flatten, stripMeta } from './lib/tokens.mjs';

const LEDGER = join(ROOT, 'verification', 'font-assets.json');
const KNOWN = join(ROOT, 'verification', 'known-issues.json');
if (!existsSync(LEDGER)) { console.error('缺少 verification/font-assets.json'); process.exit(2); }

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const T = loadTokens();
const known = existsSync(KNOWN) ? (JSON.parse(readFileSync(KNOWN, 'utf8')).issues || []).filter((k) => k.code === 'A4') : [];
const today = new Date().toISOString().slice(0, 10);
const knownFor = (s) => known.find((k) => s.indexOf(k.match) >= 0 || k.match === 'asset');

// 令牌里声明的字体族 = core.font.* 里每一项栈的第一个非通用族
const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'cursive', 'fantasy']);
const declared = new Map();
for (const role of Object.keys(T.core.font)) {
  const stack = T.core.font[role];
  for (const raw of stack) {
    const name = String(raw).replace(/^['"]|['"]$/g, '').trim();
    if (GENERIC.has(name)) continue;
    if (!declared.has(name)) declared.set(name, []);
    declared.get(name).push('font.' + role);
  }
}

const problems = [];
const warns = [];
const knownHits = [];

// A1 / A3 / A5
const byFamily = new Map(ledger.families.map((f) => [f.family, f]));
for (const [fam, roles] of declared) {
  if (!byFamily.has(fam)) problems.push('A1 令牌声明了字体族「' + fam + '」（' + roles.join(', ') + '），但台账里没有登记');
}
for (const f of ledger.families) {
  if (!f.license) problems.push('A3 ' + f.family + ' 缺少 license');
  if (!f.scope || ['web', 'desktop', 'embedding', 'redistribute'].some((k) => typeof f.scope[k] !== 'boolean')) problems.push('A3 ' + f.family + ' 缺少完整的 scope 四项');
  if (f.expires && f.expires < today) problems.push('A3 ' + f.family + ' 授权已于 ' + f.expires + ' 过期');
  if (f.status === 'active' && !declared.has(f.family)) warns.push('A5 ' + f.family + ' 标记为 active，但令牌里没有引用');
}

// A2 webfont 必须有交付证据
const uiPkgPath = join(ROOT, 'package.json');
const uiDeps = Object.assign({}, JSON.parse(readFileSync(uiPkgPath, 'utf8')).dependencies || {});
let hasFontFaceInUi = false;
for (const rel of ['packages/tokens/tokens.css', 'packages/tokens/primitives.css', 'packages/tailwind-preset/tokens.css']) {
  const p = join(ROOT, rel);
  if (existsSync(p) && /@font-face/.test(readFileSync(p, 'utf8'))) hasFontFaceInUi = true;
}
for (const f of ledger.families) {
  if (f.delivery === 'webfont' && !f.package && !hasFontFaceInUi) {
    problems.push('A2 ' + f.family + ' 标记为 webfont，但既没有 package 也没有 @font-face 证据');
  }
  if (f.delivery === 'system' && !f.note) {
    problems.push('A2 ' + f.family + ' 标记为 system，必须写明为什么不随产品分发');
  }
}

// A4 跨仓库：webfont 是否真的被消费方交付
const sitesDir = resolve(ROOT, '..', 'sites');
const consumer = { scanned: 0, installed: [], missing: [] };
if (existsSync(sitesDir)) {
  const webfonts = ledger.families.filter((f) => f.delivery === 'webfont');
  for (const s of readdirSync(sitesDir)) {
    const pkgPath = join(sitesDir, s, 'package.json');
    if (!existsSync(pkgPath)) continue;
    consumer.scanned++;
    let deps = {};
    try { const j = JSON.parse(readFileSync(pkgPath, 'utf8')); deps = Object.assign({}, j.dependencies, j.devDependencies); } catch (e) { continue; }
    for (const f of webfonts) {
      const hit = Object.keys(deps).some((k) => k === f.package || (f.family && k.toLowerCase().indexOf(f.family.toLowerCase()) >= 0));
      if (hit) consumer.installed.push(s); else consumer.missing.push(s);
    }
  }
  const uniqMissing = Array.from(new Set(consumer.missing));
  const uniqInstalled = Array.from(new Set(consumer.installed));
  if (consumer.scanned) {
    const line = 'A4 声明为 webfont 的字体里，消费方实际安装的站点 ' + uniqInstalled.length + '/' + consumer.scanned +
      '（已装: ' + (uniqInstalled.join(', ') || '无') + '）';
    const k = knownFor('Inter');
    if (k) knownHits.push({ msg: line, issue: k }); else problems.push(line + ' —— 其余站点声明的是一款它们并不交付的字体，浏览器会直接回退');
    if (k && k.expires && k.expires < today) problems.push('A4 登记 ' + k.id + ' 已过期（' + k.expires + '）');
  }
} else {
  warns.push('A4 本次工作区没有 sites/，跳过消费方核对（CI 里同样会跳过）');
}

console.log('字体资产台账：' + ledger.families.length + ' 条；令牌声明 ' + declared.size + ' 个字体族');
for (const [fam, roles] of declared) {
  const f = byFamily.get(fam);
  console.log('  ' + fam.padEnd(22) + (f ? f.delivery.padEnd(9) + (f.package || '') : '（未登记）').padEnd(28) + roles.join(', '));
}
if (consumer.scanned) console.log('消费方核对：扫描 ' + consumer.scanned + ' 个站点');
console.log('');
for (const p of problems) console.log('  [ERROR] ' + p);
for (const w of warns) console.log('  [WARN ] ' + w);
for (const h of knownHits) console.log('  [KNOWN] ' + h.msg + '  已登记为 ' + h.issue.id + '（owner ' + h.issue.owner + '，到期 ' + h.issue.expires + '）');
console.log('');
console.log(problems.length === 0 ? '结论：字体资产台账一致（' + warns.length + ' 警告，' + knownHits.length + ' 条已登记）' : '结论：字体资产校验失败（' + problems.length + ' 错误）');
process.exit(problems.length === 0 ? 0 : 1);
