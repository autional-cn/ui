#!/usr/bin/env node
// 图表色板闸门 — 断言分类色板在「每个上下文（亮色 / 暗色 / 各 profile）」下同时满足两条性质：
//
//   ① WCAG 1.4.11 非文本对比度：每个 chart-N 对页面底与卡片底都 >= 3:1
//   ② 可区分性：任意两色之间的 CIE76 dE 下限（正常视觉 + 红绿色盲模拟）
//
// 为什么需要这道闸门：
//   变更前的色板（primary/sky/amber 三色系）最差色对 dE = 6.9（正常）/ 7.2（红绿色盲）——
//   chart-1 primary-700 #003153 与 chart-8 primary-800 #002540 是两个几乎同色的近黑深蓝，
//   在 8 条数据线上不可区分；且 8 色里有 3 色不满足 3:1（amber-500 1.65、sky-500 1.74、
//   primary-300 2.46）。同时 chart-* 在 modes.dark 里完全没有覆盖，暗色主题下 chart-1 落在
//   深色底上的对比度只有 1.07:1，等于不可见。
//   这两条性质是「色板可用」的定义，不是审美偏好，所以必须机器守住而不是写在注释里。
//
// 用法: node scripts/check-chart-palette.mjs [--json]

import {
  loadTokens, resolvedIn, contrastRatio, parseHex, stripMeta, flatten
} from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');

// ── 阈值 ────────────────────────────────────────────────────────────────────
// 非文本对比度：WCAG 1.4.11 对「图形对象」的下限就是 3:1，不留余量。
const MIN_CONTRAST = 3.0;
// 可区分性下限。当前实测：亮色 19.8 正常 / 17.0 红绿色盲，暗色 14.5 / 12.5。
// 取 12 / 10 是刻意留出「允许小幅调整、但挡得住回归」的位置——
// 被修掉的旧色板是 6.9 / 7.2，会稳稳落在门外。
const MIN_DE_NORMAL = 12;
const MIN_DE_DEUT = 10;

// ── 颜色数学 ────────────────────────────────────────────────────────────────
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

// lib 的 parseHex 返回 { r, g, b, a }；本闸门内部一律用数组
const toRgb = (hex) => { const c = parseHex(hex); return c ? [c.r, c.g, c.b] : null; };

function rgbToLab(rgb) {
  const r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x / 0.95047) - f(y)), 200 * (f(y) - f(z / 1.08883))];
}

const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Vienot, Brettel & Mollon (1999) 红绿色盲（deuteranopia）模拟。
// 用它而不是只看正常视觉，是因为分类色板最典型的失败模式就是「红绿两条线长得一样」。
function deuteranopia(rgb) {
  const r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const M = 3.45565 * r + 27.1554 * g + 3.86714 * b;
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  const M2 = 0.494207 * L + 1.24827 * S;
  const R = 0.0809444479 * L - 0.130504409 * M2 + 0.116721066 * S;
  const G = -0.0102485335 * L + 0.0540193266 * M2 - 0.113614708 * S;
  const B = -0.000365296938 * L - 0.00412161469 * M2 + 0.693511405 * S;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return [R, G, B].map((v) => Math.round(clamp(encode(clamp(v))) * 255));
}

// ── 上下文 ──────────────────────────────────────────────────────────────────
const T = loadTokens();
const PROFILES = Object.keys(T.profiles).filter((p) => Object.keys(flatten(stripMeta(T.profiles[p]))).length > 0);

function contexts() {
  const out = [{ name: 'light', profile: null, variant: null }, { name: 'dark', profile: null, variant: 'dark' }];
  for (const p of PROFILES) {
    out.push({ name: p + '-light', profile: p, variant: null });
    out.push({ name: p + '-dark', profile: p, variant: 'dark' });
  }
  return out;
}

const SERIES = ['1', '2', '3', '4', '5', '6', '7', '8'];
const BGS = [
  { path: 'color.bg-primary', label: '页面底' },
  { path: 'color.bg-surface', label: '卡片底' }
];

const findings = [];
const report = [];

for (const ctx of contexts()) {
  const R = resolvedIn(T, { profile: ctx.profile, variant: ctx.variant });
  const series = [];
  for (const n of SERIES) {
    const raw = R['color.chart.' + n];
    const rgb = raw ? toRgb(raw) : null;
    if (!rgb) { findings.push({ context: ctx.name, code: 'CP1', key: 'color.chart.' + n, message: '不是可解析的十六进制色值：' + String(raw) }); continue; }
    series.push({ n, hex: raw, rgb });
  }
  if (series.length !== SERIES.length) continue;

  // ① 非文本对比度
  for (const bg of BGS) {
    const bgRgb = toRgb(R[bg.path]);
    if (!bgRgb) continue;
    for (const s of series) {
      const ratio = contrastRatio(s.hex, R[bg.path]);
      if (!(ratio >= MIN_CONTRAST)) {
        findings.push({
          context: ctx.name, code: 'CP2', key: 'color.chart.' + s.n,
          message: '对' + bg.label + '（' + R[bg.path] + '）的对比度 ' + ratio.toFixed(2) + ':1 < ' + MIN_CONTRAST + ':1（WCAG 1.4.11）'
        });
      }
    }
  }

  // ② 可区分性
  let worstNormal = { d: Infinity, pair: '' };
  let worstDeut = { d: Infinity, pair: '' };
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i], b = series[j];
      const dn = deltaE(rgbToLab(a.rgb), rgbToLab(b.rgb));
      const dd = deltaE(rgbToLab(deuteranopia(a.rgb)), rgbToLab(deuteranopia(b.rgb)));
      if (dn < worstNormal.d) worstNormal = { d: dn, pair: a.n + '-' + b.n };
      if (dd < worstDeut.d) worstDeut = { d: dd, pair: a.n + '-' + b.n };
    }
  }
  if (worstNormal.d < MIN_DE_NORMAL) {
    findings.push({ context: ctx.name, code: 'CP3', key: 'color.chart.' + worstNormal.pair,
      message: '最接近的两色 dE ' + worstNormal.d.toFixed(1) + ' < ' + MIN_DE_NORMAL + '（正常视觉），在图表上不可区分' });
  }
  if (worstDeut.d < MIN_DE_DEUT) {
    findings.push({ context: ctx.name, code: 'CP4', key: 'color.chart.' + worstDeut.pair,
      message: '最接近的两色 dE ' + worstDeut.d.toFixed(1) + ' < ' + MIN_DE_DEUT + '（红绿色盲模拟）' });
  }
  report.push({ context: ctx.name, minNormal: worstNormal, minDeut: worstDeut, palette: series.map((s) => s.hex) });
}

if (AS_JSON) {
  console.log(JSON.stringify({ thresholds: { MIN_CONTRAST, MIN_DE_NORMAL, MIN_DE_DEUT }, contexts: report, findings }, null, 2));
} else {
  console.log('图表色板闸门：色系 chart-1..8');
  console.log('  阈值 非文本对比度 >= ' + MIN_CONTRAST + ':1 · 最小色对 dE >= ' + MIN_DE_NORMAL + '（正常）/ >= ' + MIN_DE_DEUT + '（红绿色盲）');
  console.log('');
  for (const r of report) {
    console.log('  ' + r.context.padEnd(16) + ' 最小色对 dE ' + r.minNormal.d.toFixed(1).padStart(5) + ' (' + r.minNormal.pair + ')  红绿色盲 ' + r.minDeut.d.toFixed(1).padStart(5) + ' (' + r.minDeut.pair + ')');
    console.log('  ' + ' '.repeat(16) + ' ' + r.palette.join(' '));
  }
  console.log('');
  if (findings.length === 0) {
    console.log('结论：图表色板通过（' + report.length + ' 个上下文 × 8 色）');
  } else {
    for (const f of findings) console.log('  [ERROR] ' + f.code + ' ' + f.context + ' ' + f.key + ' — ' + f.message);
    console.log('结论：图表色板有 ' + findings.length + ' 项不达标');
  }
}

process.exit(findings.length === 0 ? 0 : 1);
