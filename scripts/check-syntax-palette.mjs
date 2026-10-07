#!/usr/bin/env node
// 语法着色色板闸门 — 断言 color.syntax.* 在舰队真实代码底色上同时满足两条性质：
//
//   ① 对比度：每个角色对代码底色的对比度 >= 4.5:1（WCAG 1.4.8 AA 正文级）
//   ② 可区分性：任意两色的 CIE76 dE 下限（正常视觉 + 红绿色盲模拟）
//
// 为什么需要这道闸门（和 chart 那道是同一个理由，见 check-chart-palette.mjs 抬头）：
//   代码样例里「关键字 / 字符串 / 注释」这些角色，**相邻出现在同一行**的概率极高
//   （例如 `import x from 'y'` 里关键字和字符串紧挨着）。所以「能不能区分」不是
//   审美偏好，而是这组颜色可用与否的定义。第一版候选就翻过车：keyword #c4b5fd（紫）
//   与 function #7dd3fc（天蓝）正常视觉 dE 18.9 看着挺好，红绿色盲模拟下只剩 3.3
//   —— 去红绿之后紫与天蓝几乎同色。这种失败肉眼复核不出来，必须机器守。
//
// 用法: node scripts/check-syntax-palette.mjs [--json] [--selftest]

import { loadTokens, resolvedIn, contrastRatio, parseHex } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SELFTEST = process.argv.includes('--selftest');

// ── 阈值 ────────────────────────────────────────────────────────────────────
// 正文级 AA：syntax.* 染的是代码文本，不是图形对象，所以用 4.5 而不是 1.4.11 的 3.0。
const MIN_CONTRAST = 4.5;
// 实测：最小正常 dE 31.6 / 最小红绿色盲 dE 14.8。取 12 / 10 留出「允许小幅调整、
// 但挡得住回归」的余量 —— 被否掉的第一版是 18.9 / 3.3，会稳稳落在门外。
const MIN_DE_NORMAL = 12;
const MIN_DE_DEUT = 10;

// 代码底色**从 SSOT 读**（第 63 轮结清这笔账）。
//
// 此前这里是两个字面量（#020617 / #0f172a = Tailwind 的 slate-950/900）—— 那是一条登记在案的欠账：
// 站点侧写的是 Tailwind 出厂色阶（slate 根本不在设计系统里），所以闸门只好把真实在用值抄下来，
// 免得拿一个"理想底色"自欺。第 63 轮补上 `color.bg-code`（亮 #0f172a / 暗 #020617）之后，
// 判据与取值都回到 SSOT：改令牌，闸门跟着动；底色被改坏，闸门当场报红。
const TOKENS = loadTokens();
const DARK = resolvedIn(TOKENS, { variant: 'dark' });
const CODE_SURFACES = [
  { hex: TOKENS.core.color['bg-code'], label: 'color.bg-code（亮色）' },
  { hex: DARK['color.bg-code'], label: 'color.bg-code（暗色）' }
];

const ROLES = ['plain', 'comment', 'keyword', 'string', 'number', 'function', 'type', 'tag'];

// ── 颜色数学（与 check-chart-palette.mjs 同一套实现）────────────────────────
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
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

// ── 判定（纯函数，供 --selftest 正负对照复用）────────────────────────────────
export function evaluate(syntax) {
  const findings = [];
  const colors = [];

  // 底色是判据的另一半：读不到就静默跳过 = 这道闸门变成「只查色板」，那是另一种失灵。
  for (const surface of CODE_SURFACES) {
    if (!surface.hex || !parseHex(surface.hex)) {
      findings.push({ code: 'SP0', key: 'color.bg-code', message: surface.label + ' 读不到可解析的色值：' + String(surface.hex) });
    }
  }

  for (const role of ROLES) {
    const raw = syntax[role];
    const rgb = raw ? toRgb(raw) : null;
    if (!rgb) {
      findings.push({ code: 'SP1', key: 'color.syntax.' + role, message: '不是可解析的十六进制色值：' + String(raw) });
      continue;
    }
    colors.push({ role, hex: raw, rgb });
  }
  if (colors.length !== ROLES.length) return { findings, metrics: null };

  // ① 对比度
  for (const surface of CODE_SURFACES) {
    for (const c of colors) {
      const ratio = contrastRatio(c.hex, surface.hex);
      if (!(ratio >= MIN_CONTRAST)) {
        findings.push({
          code: 'SP2', key: 'color.syntax.' + c.role,
          message: '对代码底色 ' + surface.label + '（' + surface.hex + '）的对比度 ' + ratio.toFixed(2) + ':1 < ' + MIN_CONTRAST + ':1'
        });
      }
    }
  }

  // ② 可区分性
  let worstNormal = { d: Infinity, pair: '' };
  let worstDeut = { d: Infinity, pair: '' };
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i], b = colors[j];
      const dn = deltaE(rgbToLab(a.rgb), rgbToLab(b.rgb));
      const dd = deltaE(rgbToLab(deuteranopia(a.rgb)), rgbToLab(deuteranopia(b.rgb)));
      if (dn < worstNormal.d) worstNormal = { d: dn, pair: a.role + '/' + b.role };
      if (dd < worstDeut.d) worstDeut = { d: dd, pair: a.role + '/' + b.role };
    }
  }
  if (!(worstNormal.d >= MIN_DE_NORMAL)) {
    findings.push({ code: 'SP3', key: 'color.syntax', message: '最差色对（正常视觉）' + worstNormal.pair + ' dE ' + worstNormal.d.toFixed(1) + ' < ' + MIN_DE_NORMAL });
  }
  if (!(worstDeut.d >= MIN_DE_DEUT)) {
    findings.push({ code: 'SP4', key: 'color.syntax', message: '最差色对（红绿色盲）' + worstDeut.pair + ' dE ' + worstDeut.d.toFixed(1) + ' < ' + MIN_DE_DEUT });
  }

  let minContrast = { r: Infinity, who: '' };
  for (const surface of CODE_SURFACES) {
    for (const c of colors) {
      const ratio = contrastRatio(c.hex, surface.hex);
      if (ratio < minContrast.r) minContrast = { r: ratio, who: c.role + ' vs ' + surface.label };
    }
  }

  return {
    findings,
    metrics: {
      minContrast: minContrast.r, minContrastWho: minContrast.who,
      minDeNormal: worstNormal.d, minDeNormalPair: worstNormal.pair,
      minDeDeut: worstDeut.d, minDeDeutPair: worstDeut.pair
    }
  };
}

// ── 正负对照 ────────────────────────────────────────────────────────────────
// 只跑「真值通过」会漏掉一类失效：判据写错了、恒为真。所以同时要求
// 「故意做坏的色板必须被判红」，两条都成立才算这道闸门自己在工作。
function selftest() {
  const good = TOKENS.core.color.syntax;
  const cases = [
    { name: '真值', syntax: good, expect: [] },
    // 负对照 1：还原第一版候选（keyword 紫 + function 天蓝）—— 红绿色盲下两者撞车，
    // 这正是这道闸门存在的理由，所以它必须是第一条对照。
    { name: '红绿色盲撞车', syntax: { ...good, keyword: '#c4b5fd', function: '#7dd3fc' }, expect: ['SP4'] },
    // 负对照 2：注释压暗到对比度不足
    { name: '对比度不足', syntax: { ...good, comment: '#3f4a5c' }, expect: ['SP2'] },
    // 负对照 3：色值写坏
    { name: '不可解析', syntax: { ...good, tag: 'slate-300' }, expect: ['SP1'] },
    // 负对照 4：两个角色同色
    { name: '同色', syntax: { ...good, type: good.string }, expect: ['SP3'] }
  ];
  let bad = 0;
  for (const c of cases) {
    const { findings } = evaluate(c.syntax);
    const codes = findings.map((f) => f.code);
    const ok = c.expect.length === 0
      ? findings.length === 0
      : c.expect.every((e) => codes.includes(e));
    console.log((ok ? '  PASS  ' : '  FAIL  ') + c.name + ' → [' + codes.join(',') + ']' + (c.expect.length ? ' 期望含 [' + c.expect.join(',') + ']' : ' 期望无告警'));
    if (!ok) bad += 1;
  }
  console.log(bad === 0 ? 'selftest OK：5 组对照全部符合预期' : 'selftest FAILED：' + bad + ' 组不符合预期');
  process.exit(bad === 0 ? 0 : 1);
}

if (SELFTEST) selftest();

const { findings, metrics } = evaluate(TOKENS.core.color.syntax);

if (AS_JSON) {
  console.log(JSON.stringify({ findings, metrics }, null, 2));
} else if (findings.length === 0) {
  console.log('语法色板 OK：8 个角色 · 最低对比度 ' + metrics.minContrast.toFixed(2) + ':1（' + metrics.minContrastWho + '）'
    + ' · 最差色对 dE ' + metrics.minDeNormal.toFixed(1) + '（正常 ' + metrics.minDeNormalPair + '）/ '
    + metrics.minDeDeut.toFixed(1) + '（红绿色盲 ' + metrics.minDeDeutPair + '）');
} else {
  console.log('语法色板 FAILED（' + findings.length + ' 项）：');
  for (const f of findings) console.log('  [' + f.code + '] ' + f.key + ' — ' + f.message);
}
process.exit(findings.length === 0 ? 0 : 1);
