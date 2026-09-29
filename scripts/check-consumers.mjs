#!/usr/bin/env node
// check-consumers — 消费者副本漂移：SSOT 只在 ui/ 内成立，消费者拿的是拷贝
// 用法: node scripts/check-consumers.mjs
//
// 背景（实测）：9 个站点各自带一份 packages/tailwind-preset/tokens.css 拷贝，
// 且没有任何站点声明对 @autional-cn/* 的依赖 —— 交付方式是「手工拷贝」。
// 实测 admin 的拷贝只有 89 个变量，权威版本有 186 个，缺 97 个（含整组 chart-* 与 method-*）。
// gen:check / lint-tokens / token-lock 都只看 ui/ 内部，看不见这件事。

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/tokens.mjs';

const AUTH = join(ROOT, 'packages', 'tokens', 'tokens.css');
const CONFIG = join(ROOT, 'verification', 'consumer-targets.json');
const varsOf = (css) => new Set(Array.from(css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)).map((m) => m[1]));

if (!existsSync(AUTH)) { console.error('缺少权威产物 packages/tokens/tokens.css'); process.exit(2); }
if (!existsSync(CONFIG)) { console.log('未配置 verification/consumer-targets.json，跳过消费者检查'); process.exit(0); }

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
// 只取第一个 :root 块：变体块（.dark / [data-theme=...]）会重复声明同名变量，
// 扫全文会把主题值当成「取值不同」，那是解析假阳性而不是真分叉。
function rootBlock(css) {
  const i = css.indexOf(':root');
  if (i < 0) return css;
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (depth === 0) return css.slice(open + 1, j); }
  }
  return css.slice(open + 1);
}
function rootVars(css) {
  const body = rootBlock(css);
  const out = {};
  for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const authFlat = rootVars(readFileSync(AUTH, 'utf8'));
const authVars = new Set(Object.keys(authFlat));

// 与 lint-tokens 同一套纪律：漂移可以是「已登记的问题」，但必须有 owner 与到期日
const KNOWN_PATH = join(ROOT, 'verification', 'known-issues.json');
const known = existsSync(KNOWN_PATH) ? (JSON.parse(readFileSync(KNOWN_PATH, 'utf8')).issues || []).filter((k) => k.code === 'T11') : [];
const today = new Date().toISOString().slice(0, 10);
const knownFor = (label) => known.find((k) => label.indexOf(k.match) >= 0 || k.match === 'consumer');
const expiredKnown = known.filter((k) => k.expires && k.expires < today);

const patterns = cfg.targets || [];
let checked = 0, drifted = 0, knownDrift = 0;
const present = [];

for (const rel of patterns) {
  // 允许用 * 通配一级目录名
  const m = rel.match(/^([^*]*)\*([^*]*)$/);
  let files = [];
  if (m) {
    const baseDir = resolve(ROOT, m[1]);
    if (existsSync(baseDir)) {
      const fs = await import('node:fs');
      for (const name of fs.readdirSync(baseDir)) {
        const p = join(baseDir, name, m[2].replace(/^\//, ''));
        if (existsSync(p)) files.push(p);
      }
    }
  } else {
    const p = resolve(ROOT, rel);
    if (existsSync(p)) files.push(p);
  }
  for (const f of files) {
    present.push(f);
    checked++;
    const css = readFileSync(f, 'utf8');
    const local = rootVars(css);
    const vars = new Set(Object.keys(local));
    const missing = Array.from(authVars).filter((v) => !vars.has(v));
    const extra = Array.from(vars).filter((v) => !authVars.has(v));
    const changed = Array.from(vars).filter((v) => authVars.has(v) && local[v] !== authFlat[v]);
    const label = f.replace(resolve(ROOT, '..') + '\\', '').replace(resolve(ROOT, '..') + '/', '');
    if (missing.length || extra.length || changed.length) {
      const k = knownFor(label);
      if (k) knownDrift++; else drifted++;
      console.log('  [' + (k ? 'KNOWN' : 'DRIFT') + '] ' + label + (k ? '  已登记为 ' + k.id + '（owner ' + k.owner + '，到期 ' + k.expires + '）' : ''));
      console.log('          权威 :root ' + authVars.size + ' 个变量 / 副本 :root ' + vars.size + ' 个');
      if (missing.length) console.log('          缺失 ' + missing.length + ' 个：' + missing.slice(0, 8).join(', ') + (missing.length > 8 ? ' …' : ''));
      if (extra.length) console.log('          多出 ' + extra.length + ' 个：' + extra.slice(0, 8).join(', '));
      if (changed.length) console.log('          取值不同 ' + changed.length + ' 个：' + changed.slice(0, 6).join(', '));
    } else {
      console.log('  [OK]    ' + label);
    }
  }
}

// ── 字节级目标：index.js / index.d.ts 这类非 CSS 产物没有 :root 可比，
// 且它们是纯生成物，逐字节一致才是正确判据（sync:consumers 保证这一点）。
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);
for (const bt of (cfg.byteTargets || [])) {
  const authPath = resolve(ROOT, bt.auth);
  if (!existsSync(authPath)) { console.log('  [缺失]  权威产物不存在：' + bt.auth); drifted++; continue; }
  const authSha = sha(authPath);
  const m2 = bt.copy.match(/^([^*]*)\*([^*]*)$/);
  if (!m2) continue;
  const baseDir2 = resolve(ROOT, m2[1]);
  if (!existsSync(baseDir2)) continue;
  const fs2 = await import('node:fs');
  for (const name of fs2.readdirSync(baseDir2)) {
    const copyPath = join(baseDir2, name, m2[2].replace(/^\//, ''));
    if (!existsSync(copyPath)) continue;
    checked++;
    const label = copyPath.replace(resolve(ROOT, '..') + '\\', '').replace(resolve(ROOT, '..') + '/', '');
    const copySha = sha(copyPath);
    if (copySha === authSha) { console.log('  [OK]    ' + label + '  sha=' + copySha); continue; }
    const k = knownFor(label);
    if (k) { knownDrift++; console.log('  [KNOWN] ' + label + '  已登记为 ' + k.id); }
    else { drifted++; console.log('  [DRIFT] ' + label + '  sha=' + copySha + ' != 权威 ' + authSha + '（重新生成：pnpm sync:consumers --site <站点> --write）'); }
  }
}

// ── 交付通道：设计系统必须走 npm，不得回退成内置副本（2026-09 P4 收口）────────────
// 此前 14 个站点各存一份 packages/tailwind-preset/ 拷贝，命名空间是伪造的：读起来像在消费
// 设计系统，实际用的是自己仓库里的分支（KI-006）。P4 已把 14 个站点改成依赖已发布的
// @autional-cn/*，内置副本全部删除。这条断言防的是「又退回去」——而且它同时补上了上面
// 那些拷贝比对的**盲区**：副本删光后 targets/byteTargets 只匹配到共享组件层，
// 「每个站点都真的从 npm 消费设计系统」这件事本身没有任何闸门在看。
const SITES_DIR = resolve(ROOT, '..', 'sites');
const NPM_REQUIRED = ['@autional-cn/tailwind-preset', '@autional-cn/tokens'];
let channelChecked = 0;
let channelBad = 0;
let vendorFound = 0;
if (existsSync(SITES_DIR)) {
  for (const site of readdirSync(SITES_DIR)) {
    const sitePath = join(SITES_DIR, site);
    if (!statSync(sitePath).isDirectory()) continue;
    channelChecked++;
    if (existsSync(join(sitePath, 'packages', 'tailwind-preset'))) {
      channelBad++;
      vendorFound++;
      console.log('  [DRIFT] ' + site + '：仍有内置副本 packages/tailwind-preset/ —— 设计系统已由 npm 交付，副本必须删除');
    }
    // 收集该站点所有 package.json 里对 @autional-cn/* 的声明
    const decl = {};
    const pjs = [join(sitePath, 'package.json')];
    for (const g of ['apps', 'packages']) {
      const gd = join(sitePath, g);
      if (!existsSync(gd)) continue;
      for (const e of readdirSync(gd)) pjs.push(join(gd, e, 'package.json'));
    }
    for (const p of pjs) {
      if (!existsSync(p)) continue;
      let j;
      try { j = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { continue; }
      for (const key of ['dependencies', 'devDependencies']) {
        for (const [k, v] of Object.entries(j[key] || {})) if (k.indexOf('@autional-cn/') === 0) decl[k] = v;
      }
    }
    for (const pkg of NPM_REQUIRED) {
      if (!(pkg in decl)) {
        channelBad++;
        console.log('  [DRIFT] ' + site + '：未声明 ' + pkg + ' —— 设计系统必须从 npm 消费');
      } else if (String(decl[pkg]).indexOf('workspace:') === 0) {
        channelBad++;
        console.log('  [DRIFT] ' + site + '：' + pkg + ' 仍声明为 ' + decl[pkg] + '（内置副本式），应指向已发布版本');
      }
    }
  }
  if (!channelBad) console.log('  [OK]    交付通道：' + channelChecked + ' 个站点均从 npm 消费设计系统，无内置副本');
}
drifted += channelBad;

console.log('');
if (!checked) {
  console.log('消费者检查：未发现配置里的目标路径（当前工作区只有 ui/ 时属正常）。');
  console.log('  CI 里这个检查无法生效——它需要 sites/ 与 ui/ 同时存在。');
  process.exit(0);
}
if (expiredKnown.length) {
  console.log('  [ERROR] 有 ' + expiredKnown.length + ' 条消费者漂移登记已过期：' + expiredKnown.map((k) => k.id + '(' + k.expires + ')').join(', '));
  drifted += expiredKnown.length;
}
console.log('消费者检查：' + checked + ' 个副本，' + drifted + ' 个未登记不一致，' + knownDrift + ' 个已登记');
console.log('  交付通道：' + channelChecked + ' 个站点（设计系统走 npm；内置副本 ' + vendorFound + ' 个）' + (channelBad ? '，' + channelBad + ' 处不合规' : '，全部合规'));
if (drifted) {
  console.log('');
  console.log('这些站点运行的不是 SSOT 生成的令牌。gen:check / lint-tokens / token-lock 都看不见这件事，');
  console.log('因为它们只检查 ui/ 内部。修复方向见 verification/known-issues.json 的 KI-006。');
  process.exit(1);
}
if (knownDrift) {
  console.log('结论：' + knownDrift + ' 个消费者副本与权威产物**不一致**，但都已在 known-issues.json 登记。');
  console.log('      这不是「一致」，是「有期限的已知漂移」——到期未处理即失败。');
  process.exit(0);
}
console.log('结论：消费者副本与权威产物一致');
process.exit(0);
