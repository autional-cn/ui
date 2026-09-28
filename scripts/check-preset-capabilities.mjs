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
import { ROOT } from './lib/tokens.mjs';

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

if (!existsSync(SITES)) { console.log('check-preset-capabilities：本次工作区没有 sites/，跳过'); process.exit(0); }

const SKIPDIR = new Set(['node_modules', '.git', 'dist', '.astro', '.next', 'public', 'build', 'coverage']);
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
for (const site of readdirSync(SITES)) {
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

if (AS_JSON) console.log(JSON.stringify({ rows, problems }, null, 2));
else {
  if (rows.length) {
    console.log('预设能力契约：检查 ' + rows.length + ' 处「模板用了需要插件的类」');
    for (const r of rows) console.log('  ' + (r.configured && r.installed ? '[OK]   ' : '[ERROR] ') + r.site.padEnd(13) + r.pkg.padEnd(28) + r.used);
  } else console.log('预设能力契约：没有站点使用需要额外插件的类');
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length ? '结论：有 ' + problems.length + ' 处「构建成功但能力不存在」' : '结论：预设能力契约通过');
}
process.exit(problems.length ? 1 : 0);
