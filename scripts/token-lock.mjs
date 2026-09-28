#!/usr/bin/env node
// token-lock — 令牌快照锁：任何令牌变化都必须显式登记，否则构建失败
// 用法: node scripts/token-lock.mjs            重建快照（= 声明「这次变更是有意的」）
//       node scripts/token-lock.mjs --check    比对快照
//
// 与 gen:check 的区别：
//   gen:check 问「产物跟得上 SSOT 吗」     —— 改 tokens.json 后跑一次 gen 就通过
//   token-lock 问「SSOT 本身被改过吗」     —— 改了什么必须写下来，有 owner 与到期日

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ROOT, TOKENS_PATH, loadTokens, flatten, stripMeta, orderedVariants, variantMap } from './lib/tokens.mjs';

const CHECK = process.argv.includes('--check');
const LOCK_PATH = join(ROOT, 'verification', 'tokens.lock.json');
const APPROVALS_PATH = join(ROOT, 'verification', 'token-change-approvals.json');

/** 把全部层展平成 层:路径 -> 值，便于人类读 diff，也便于算稳定哈希 */
function snapshot() {
  const T = loadTokens();
  const out = {};
  for (const p of Object.keys(flatten(stripMeta(T.core))).sort()) out['core:' + p] = flatten(stripMeta(T.core))[p];
  const all = variantMap(T);
  for (const name of orderedVariants(T)) {
    const node = all[name];
    if (!node || node.$kind === 'runtime') continue;
    const flat = flatten(stripMeta(node));
    for (const p of Object.keys(flat).sort()) out['variant:' + name + ':' + p] = flat[p];
  }
  for (const [name, profile] of Object.entries(T.profiles)) {
    const flat = flatten(stripMeta(profile));
    for (const p of Object.keys(flat).sort()) out['profile:' + name + ':' + p] = flat[p];
  }
  return out;
}

function hashOf(snap) {
  const keys = Object.keys(snap).sort();
  return createHash('sha256').update(keys.map((k) => k + '=' + JSON.stringify(snap[k])).join('\n')).digest('hex');
}

function loadApprovals() {
  if (!existsSync(APPROVALS_PATH)) return [];
  try { return JSON.parse(readFileSync(APPROVALS_PATH, 'utf8')).approved || []; } catch (e) { return []; }
}

const snap = snapshot();
const hash = hashOf(snap);

if (!CHECK) {
  mkdirSync(join(ROOT, 'verification'), { recursive: true });
  writeFileSync(LOCK_PATH, JSON.stringify({
    $description: '令牌快照锁（生成物，勿手改）。重建：node scripts/token-lock.mjs。比对：node scripts/token-lock.mjs --check。',
    hash: hash,
    generatedAt: new Date().toISOString(),
    entries: Object.keys(snap).length,
    tokens: snap
  }, null, 2) + '\n');
  console.log('已写入令牌快照：' + Object.keys(snap).length + ' 条，hash=' + hash.slice(0, 16));
  console.log('路径：verification/tokens.lock.json');
  process.exit(0);
}

if (!existsSync(LOCK_PATH)) {
  console.error('缺少 verification/tokens.lock.json，先运行: node scripts/token-lock.mjs');
  process.exit(2);
}
const base = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
const baseTokens = base.tokens || {};
const added = Object.keys(snap).filter((k) => !(k in baseTokens));
const removed = Object.keys(baseTokens).filter((k) => !(k in snap));
const changed = Object.keys(snap).filter((k) => k in baseTokens && JSON.stringify(snap[k]) !== JSON.stringify(baseTokens[k]));

const approvals = loadApprovals();
const today = new Date().toISOString().slice(0, 10);
const covered = (k) => approvals.find((a) => k.indexOf(a.match) >= 0 || k === a.match);
const unapprovedAdded = added.filter((k) => !covered(k));
const unapprovedRemoved = removed.filter((k) => !covered(k));
const unapprovedChanged = changed.filter((k) => !covered(k));
const expired = approvals.filter((a) => a.expires && a.expires < today);
const draftApprovals = approvals.filter((a) => a.draft === true);

console.log('令牌快照比对：基线 ' + base.entries + ' 条 / 当前 ' + Object.keys(snap).length + ' 条');
console.log('  hash 基线 ' + String(base.hash).slice(0, 16) + ' / 当前 ' + hash.slice(0, 16));
function report(label, list, total) {
  if (!list.length) return;
  console.log('  ' + label + ' ' + list.length + '/' + total + ' 条未登记');
  for (const k of list.slice(0, 15)) {
    const a = baseTokens[k], b = snap[k];
    console.log('    ' + k + (b !== undefined ? '\n        基线 ' + JSON.stringify(a) + ' -> 当前 ' + JSON.stringify(b) : ''));
  }
  if (list.length > 15) console.log('    … 其余 ' + (list.length - 15) + ' 条');
}
report('新增', unapprovedAdded, added.length);
report('删除', unapprovedRemoved, removed.length);
report('修改', unapprovedChanged, changed.length);
if (!added.length && !removed.length && !changed.length) console.log('  令牌无变化');
if (expired.length) console.log('  [ERROR] 有 ' + expired.length + ' 条变更登记已过期：' + expired.map((a) => a.match + '(' + a.expires + ')').join(', '));
if (draftApprovals.length) console.log('  [NOTE ] ' + draftApprovals.length + ' 条登记标记为 draft（在内容提交前需转为正式登记）：' + draftApprovals.map((a) => a.match).join(', '));

const bad = unapprovedAdded.length + unapprovedRemoved.length + unapprovedChanged.length + expired.length;
if (bad === 0) {
  console.log('结论：令牌快照一致' + (changed.length ? '（' + changed.length + ' 条为已登记变更）' : ''));
  process.exit(0);
}
console.log('结论：令牌快照有 ' + bad + ' 项未登记变更');
console.log('如确认变更是有意的：在 verification/token-change-approvals.json 登记（reason + owner + expires）后重跑，或运行 node scripts/token-lock.mjs 重建快照。');
process.exit(1);
