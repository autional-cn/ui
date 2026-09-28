// tokens.mjs — 令牌加载 / 展平 / 解析 / 层叠模拟
// 与 scripts/generate.mjs 保持同一套语义：lookup 从最后一层往前找，{a.b.c} 引用递归解析。
// 注意：这里刻意不引入任何依赖，verify 可在无 node_modules 的环境下运行。

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TOKENS_PATH = join(ROOT, 'tokens', 'tokens.json');

export const isMeta = (k) => typeof k === 'string' && k.startsWith('$');
export const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).filter((k) => !isMeta(k)) : []);
export const isRef = (v) => typeof v === 'string' && /^\{[^}]+\}$/.test(v);
export const refPath = (v) => v.slice(1, -1).split('.');
export const stripMeta = (node) => Object.fromEntries(Object.entries(node || {}).filter(([k]) => !isMeta(k)));

export function loadTokens(p) {
  return JSON.parse(readFileSync(p || TOKENS_PATH, 'utf8'));
}

/** 展平成 path -> 叶子值。形如 color.primary.500 / font-size.base.size */
export function flatten(node, prefix, out) {
  out = out || {};
  prefix = prefix || '';
  for (const k of keysOf(node)) {
    const v = node[k];
    const path = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

/** 变体块的输出顺序。generate.mjs 的 VARIANT_ORDER 必须与此一致。 */
export const VARIANT_ORDER = ['portal', 'auth', 'dark', 'authenticator'];

export function variantMap(T) {
  return Object.assign({}, T.variants, { dark: T.modes.dark });
}

export function orderedVariants(T) {
  const all = variantMap(T);
  return VARIANT_ORDER.filter((n) => all[n]).concat(Object.keys(all).filter((n) => !VARIANT_ORDER.includes(n)));
}

/** 与 generate.mjs 的 makeResolver 同构 */
export function makeResolver(layers) {
  const lookup = (path) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      let node = layers[i];
      let ok = node !== undefined;
      for (const seg of path) {
        if (node !== null && typeof node === 'object' && seg in node) node = node[seg];
        else { ok = false; break; }
      }
      if (ok) return node;
    }
    return undefined;
  };
  const resolve = (value, depth) => {
    depth = depth || 0;
    if (depth > 16) throw new Error('Reference cycle at ' + JSON.stringify(value));
    if (typeof value !== 'string' || !isRef(value)) return value;
    const raw = lookup(refPath(value));
    if (raw === undefined) throw new Error('Unresolved reference ' + value);
    return resolve(raw, depth + 1);
  };
  return { resolve, raw: (path) => lookup(path) };
}

/** 某个上下文下的层数组：core → profile → variant（与 CSS 加载顺序一致） */
export function contextLayers(T, opts) {
  opts = opts || {};
  const layers = [stripMeta(T.core)];
  if (opts.profile && T.profiles[opts.profile]) layers.push(stripMeta(T.profiles[opts.profile]));
  const all = variantMap(T);
  if (opts.variant && all[opts.variant]) layers.push(stripMeta(all[opts.variant]));
  return layers;
}

export function resolvedIn(T, opts) {
  const layers = contextLayers(T, opts);
  const r = makeResolver(layers);
  const out = {};
  for (const p of Object.keys(flatten(T.core))) {
    try { out[p] = r.resolve('{' + p + '}'); } catch (e) { out[p] = undefined; }
  }
  return out;
}

/** CSS 变量名规则：--{path 用 - 连接}，与 generate.mjs 的 varName 一致 */
export const cssVarName = (path) => '--' + path.split('.').join('-');

// ── 层叠模型 ────────────────────────────────────────────────────────────────
// 真实产物结构：
//   packages/tokens/tokens.css   :root { core }  +  变体块（按 VARIANT_ORDER）
//   packages/tokens/profiles/X.css  :root { profile }   ← 在 tokens.css 之后加载
// :root 与 .dark / [data-theme] 特指度相同（0,1,0），同分时**源码顺序靠后者胜**。
// 因此 profile 的 :root 会压掉 tokens.css 里的变体覆盖——这正是要检测的冲突。

export function cascadeDeclarations(T) {
  const decls = [];
  const add = (path, selector, order, source) => decls.push({ path, selector, order, source });
  const coreFlat = flatten(T.core);
  for (const p of Object.keys(coreFlat)) add(p, ':root', 1, 'core');
  const all = variantMap(T);
  orderedVariants(T).forEach((name, i) => {
    const node = all[name];
    if (node && node.$kind === 'runtime') return;
    const flat = flatten(stripMeta(node));
    for (const p of Object.keys(flat)) add(p, name === 'dark' ? '.dark' : '[data-theme="' + name + '"]', 2 + i, 'variant:' + name);
  });
  for (const [name, profile] of Object.entries(T.profiles)) {
    const flat = flatten(stripMeta(profile));
    for (const p of Object.keys(flat)) add(p, ':root', 100, 'profile:' + name);
  }
  return decls;
}

/** 在给定上下文下，某条路径的声明按胜负排序 */
export function cascadeFor(T, path, opts) {
  opts = opts || {};
  const all = variantMap(T);
  const active = new Set(['core']);
  if (opts.profile) active.add('profile:' + opts.profile);
  if (opts.variant && all[opts.variant]) active.add('variant:' + opts.variant);
  const hits = cascadeDeclarations(T).filter((d) => d.path === path && active.has(d.source));
  // 胜者 = 声明顺序最大者（源码顺序靠后）
  return hits.sort((a, b) => a.order - b.order);
}

// 关键：JS 解析器的层序是 [core, profile, variant]，最后加入者胜（variant 赢）；
// 但 CSS 里 profile 在另一个文件、之后加载，同为 0,1,0 特指度时**源码顺序靠后者胜**（profile 赢）。
// 两者结论相反——所以这里必须按「CSS 胜者」单独求值，不能用 JS 层序推。
function valueFromSource(T, path, source, opts) {
  const all = variantMap(T);
  let layers;
  if (source === 'core') layers = [stripMeta(T.core)];
  else if (source.indexOf('profile:') === 0) layers = [stripMeta(T.core), stripMeta(T.profiles[source.slice(8)])];
  else if (source.indexOf('variant:') === 0) layers = [stripMeta(T.core), stripMeta(all[source.slice(8)])];
  else layers = contextLayers(T, opts);
  try { return makeResolver(layers).resolve('{' + path + '}'); } catch (e) { return undefined; }
}

export function cascadeWinner(T, path, opts) {
  const hits = cascadeFor(T, path, opts);
  if (!hits.length) return { winner: null, hits: [] };
  const last = hits[hits.length - 1];
  // CSS 实际生效值 = 胜出声明所在层的解析结果
  const value = valueFromSource(T, path, last.source, opts);
  // 「本应」的值 = 不考虑 profile 时的解析结果（JS 消费方看到的值）
  let valueWithoutProfile;
  try {
    valueWithoutProfile = makeResolver(contextLayers(T, { variant: opts.variant })).resolve('{' + path + '}');
  } catch (e) { valueWithoutProfile = undefined; }
  // JS 消费方（dist/tokens.json + antd 桥）看不到 profile，因此拿到的是 valueWithoutProfile
  return { winner: last.source, selector: last.selector, value, valueWithoutProfile, hits };
}

/** 主题/变体覆盖了哪些路径 */
export function themeOverridden(T) {
  const out = new Map();
  const all = variantMap(T);
  for (const name of orderedVariants(T)) {
    const node = all[name];
    if (!node || node.$kind === 'runtime') continue;
    out.set(name, new Set(Object.keys(flatten(stripMeta(node)))));
  }
  return out;
}

/** 各 profile 覆盖了哪些路径 */
export function profileOverridden(T) {
  const out = new Map();
  for (const [name, profile] of Object.entries(T.profiles)) {
    out.set(name, new Set(Object.keys(flatten(stripMeta(profile)))));
  }
  return out;
}

// ── 颜色与尺寸工具 ──────────────────────────────────────────────────────────
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function parseHex(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(HEX);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  };
}

export function relativeLuminance(hex) {
  const c = parseHex(hex);
  if (!c) return null;
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG 2.x 对比度。前景若带 alpha，按与背景合成后再算。 */
export function contrastRatio(fg, bg) {
  const F = parseHex(fg), B = parseHex(bg);
  if (!F || !B) return null;
  const compose = (f, b) => ({
    r: f.a >= 1 ? f.r : Math.round(f.r * f.a + b.r * (1 - f.a)),
    g: f.a >= 1 ? f.g : Math.round(f.g * f.a + b.g * (1 - f.a)),
    b: f.a >= 1 ? f.b : Math.round(f.b * f.a + b.b * (1 - f.a))
  });
  const toHex = (c) => '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');
  const l1 = relativeLuminance(toHex(compose(F, B)));
  const l2 = relativeLuminance(toHex(B));
  if (l1 === null || l2 === null) return null;
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export const DIMENSION = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ch|ex)$/;
export const DURATION = /^\d+(\.\d+)?m?s$/;
export const CUBIC = /^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/;
export const SHADOW = /(^|\s)(-?\d+(\.\d+)?px)\s+(-?\d+(\.\d+)?px)/;
export const GRADIENT = /^(linear|radial|conic)-gradient\(/;
