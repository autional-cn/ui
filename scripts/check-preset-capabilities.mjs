#!/usr/bin/env node
// 预设能力契约闸门（verify 第 14 道）
//
// 抓的是**「构建成功但能力不存在」**这一类失败——执行日志 §U66 的机制教训：
// 逐值比对发现不了这种回归，因为「值在、能力没了」。
//
// 具体形态：模板里写了某个由 Tailwind 插件提供的类，但站点的 tailwind.config 没装那个插件。
// 构建照常成功、没有任何警告，页面渲染出来却是没有样式的内容。
//
// 实测（2026-09-29）：user 站的公告页写着 className="prose prose-sm max-w-none …"，
// 而它的 tailwind.config.ts 是 plugins: []，构建产物 CSS 里 **.prose 一条规则都没有**。
// 全站 49,927 字节 CSS 中没有该类。加装 @tailwindcss/typography 后变为 68,477 字节。
//
// 用法: node scripts/check-preset-capabilities.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT, loadTokens, stripMeta } from './lib/tokens.mjs';
import { makeSkip } from './lib/scan-scope.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');

// 需要插件才能生效的类 → 所需插件的包名。
// 表要保守：只收「用了但没装会静默失效」的类，收多了会变成噪声。
// 表要保守：只收「用了但没装会**静默**失效」的类，收多了会变成噪声。
//
// **line-clamp 已刻意移出这张表。** 第一版把它收进来了，报了 4 处失败；
// 逐站查构建产物后确认是假阳性——Tailwind 3.3 起 line-clamp 已内置
// （全舰队是 3.4.19），三个站点的产物 CSS 里 .line-clamp-N 规则都在。
// 我在这条规则自己的 note 里就写了「3.3+ 已内置」，却没有真的去查版本，
// 于是写出了一条会误报的规则。教训：注释里写下的前提，代码里必须真的验证。
const NEEDS_PLUGIN = [
  { probe: /(^|[\s"'`])prose(-[a-z0-9]+)?([\s"'`]|$)/, pkg: '@tailwindcss/typography', label: 'prose' },
];

// ── 预设产物能力（ui 侧，U394/U389，2026-10-05）──────────────────────────────
// 上文管站点「模板用了插件类、插件没装」；这一段管预设**产物自身**的能力面：
//  ① 色值全走通道三元组 `rgb(var(--color-*-rgb))` —— U394 根修后的唯一合法形态。
//     回归为裸 `var(--color-*)`/hex 时，带 `/NN` 的类被 Tailwind 3.4 静默丢弃
//     （parseColor 宽松路径拿不到通道 → undefined → 整条规则不生成）；全舰队实测
//     112 处死类 + 65 处 arbitrary-var 死类即此根因。
//  ② 每个被引用的伴随变量 `--color-*-rgb` 在 tokens.css 有声明（没了通道 = 死类回归）。
//  ③ 语义文本色类组（U389）：tokens 每个 /^text-/ 键（除 text-inverse——flat inverse
//     色已提供 text-inverse 类）都有一一对应的插件工具类，且绑同名令牌变量。
const presetProblems = [];
const presetStats = { colors: 0, companions: 0, semantic: 0 };
const SITES_ABSENT = !existsSync(SITES);
try {
  const { createRequire } = await import('node:module');
  const preset = createRequire(import.meta.url)(join(ROOT, 'packages', 'tailwind-preset', 'index.js'));
  const tokensCss = readFileSync(join(ROOT, 'packages', 'tokens', 'tokens.css'), 'utf8');

  const VALUE_OK = /^rgb\(var\(--color-[a-z0-9-]+-rgb\)\)$/;
  const referenced = new Set();
  const walkColors = (node, path) => {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        presetStats.colors++;
        if (!VALUE_OK.test(v)) {
          presetProblems.push('P1 色值未走通道三元组：theme.extend.colors.' + path + k + ' = ' + JSON.stringify(v) +
            '—— 回归为裸 var()/hex 时带 /NN 的类被 Tailwind 静默丢弃（U394 根因）；应为 rgb(var(--color-<名>-rgb))');
        } else {
          referenced.add(v.match(/--color-[a-z0-9-]+-rgb/)[0]);
        }
      } else if (v && typeof v === 'object') walkColors(v, path + k + '.');
    }
  };
  walkColors(preset.theme?.extend?.colors ?? {}, '');
  for (const name of referenced) {
    presetStats.companions++;
    if (!tokensCss.includes(name + ':')) {
      presetProblems.push('P1 tokens.css 缺伴随变量声明 ' + name + '（preset 引用了它 ⇒ /NN 路径解析不到通道，整类死亡）');
    }
  }

  const utilities = {};
  for (const p of preset.plugins ?? []) {
    const fn = typeof p === 'function' ? p : p && typeof p.handler === 'function' ? p.handler : null;
    if (!fn) continue;
    try { fn({ addUtilities: (u) => Object.assign(utilities, u) }); }
    catch (e) { presetProblems.push('P1 预设插件执行失败（语义类组无法生成）：' + e.message); }
  }
  const expectedSemantic = Object.keys(stripMeta(loadTokens().core.color))
    .filter((k) => /^text-[a-z0-9-]+$/.test(k) && k !== 'text-inverse');
  presetStats.semantic = expectedSemantic.length;
  for (const name of expectedSemantic) {
    const u = utilities['.' + name];
    if (!u || u.color !== 'var(--color-' + name + ')') {
      presetProblems.push('P1 语义文本类缺失/错绑：.' + name + ' 应为 { color: \'var(--color-' + name + ')\' }（U389 类组应与 tokens /^text-/ 键一一对应）');
    }
  }
  const extra = Object.keys(utilities).filter((k) => !expectedSemantic.includes(k.slice(1)));
  if (extra.length) {
    presetProblems.push('P1 插件工具类超出令牌派生集：' + extra.join('、') + '——语义类组由 tokens /^text-/ 键单源派生，勿手工加类');
  }
} catch (e) {
  presetProblems.push('P1 预设产物加载失败：' + e.message);
}

const SKIPDIR = makeSkip('public');
function walk(d, out, test) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (SKIPDIR.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out, test); else if (test(e.name)) out.push(p);
  }
  return out;
}

const problems = [];
const rows = [];
if (SITES_ABSENT) console.log('check-preset-capabilities：本次工作区没有 sites/，跳过站点面');
for (const site of SITES_ABSENT ? [] : readdirSync(SITES)) {
  const dir = join(SITES, site);
  if (!statSync(dir).isDirectory()) continue;

  // 站点自己的 tailwind 配置（可能在 apps/<app>/ 下）
  const cfgs = walk(dir, [], (n) => /^tailwind\.config\.[cm]?[jt]s$/.test(n));
  if (!cfgs.length) continue;
  const cfgText = cfgs.map((f) => readFileSync(f, 'utf8')).join('\n');

  // 模板里用了哪些插件类
  const tpl = walk(dir, [], (n) => /\.(tsx|jsx|astro|html|md|mdx)$/.test(n));
  const used = new Map();
  for (const f of tpl) {
    const t = readFileSync(f, 'utf8');
    for (const rule of NEEDS_PLUGIN) {
      if (rule.probe.test(t)) {
        if (!used.has(rule.pkg)) used.set(rule.pkg, { label: rule.label, where: relative(SITES, f).replace(/\\/g, '/') });
      }
    }
  }
  if (!used.size) continue;

  const installed = new Set();
  for (const f of cfgs) {
    const m = readFileSync(f, 'utf8');
    for (const rule of NEEDS_PLUGIN) {
      // 配置里 require/import 了该插件，或直接从 node_modules 解析得到
      if (new RegExp(rule.pkg.replace(/[/@.]/g, (c) => '\\' + c)).test(m)) installed.add(rule.pkg);
    }
    // 也接受「通过别名引入」：从本文件所在目录向上找 node_modules
  }
  for (const [pkg, info] of used) {
    const hasNodeModule = cfgs.some((f) => {
      let d = join(f, '..');
      for (let i = 0; i < 4; i++) {
        if (existsSync(join(d, 'node_modules', pkg))) return true;
        d = join(d, '..');
      }
      return false;
    });
    const ok = installed.has(pkg) && hasNodeModule;
    rows.push({ site, pkg, used: info.where, configured: installed.has(pkg), installed: hasNodeModule });
    if (!ok) {
      problems.push('P1 ' + site + '：模板用了 ' + info.label + '（' + info.where + '），但 ' +
        (installed.has(pkg) ? '' : 'tailwind.config 里没有 ' + pkg + '；') +
        (hasNodeModule ? '' : '依赖里也没装 ' + pkg + '；') +
        '结果：构建成功，但产物 CSS 里没有任何对应规则，页面渲染成无样式内容（实测过 user 站）');
    }
  }
}

const total = presetProblems.length + problems.length;
if (AS_JSON) console.log(JSON.stringify({ preset: { stats: presetStats, problems: presetProblems }, rows, problems }, null, 2));
else {
  console.log('预设产物能力（通道三元组 + 语义类组）：色值 ' + presetStats.colors + ' 项，引用伴随变量 ' +
    presetStats.companions + ' 个，语义文本类 ' + presetStats.semantic + ' 项 —— ' +
    (presetProblems.length ? '有 ' + presetProblems.length + ' 项失败' : '通过'));
  for (const p of presetProblems) console.log('  [ERROR] ' + p);
  if (rows.length) {
    console.log('预设能力契约：检查 ' + rows.length + ' 处「模板用了需要插件的类」');
    for (const r of rows) console.log('  ' + (r.configured && r.installed ? '[OK]   ' : '[ERROR] ') + r.site.padEnd(13) + r.pkg.padEnd(28) + r.used);
  } else if (!SITES_ABSENT) console.log('预设能力契约：没有站点使用需要额外插件的类');
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(total ? '结论：有 ' + total + ' 处「构建成功但能力不存在」' : '结论：预设能力契约通过');
}
process.exit(total ? 1 : 0);
