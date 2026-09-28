#!/usr/bin/env node
// 类名可达性闸门（verify 第 15 道）
//
// 规则来自 preset 的构造方式，不是经验猜测：
//   Tailwind 要生成 {utility}-{name}，需要 colors[name] 存在。
//   设计系统的 primary / sky / amber / neutral / chart / method 在 preset 里是**色阶对象**
//   （{50:…, 900:…}），没有 DEFAULT 键。
//   ⇒ 裸的 bg-primary / text-primary / border-primary 一个类都生成不出来。
//
// 为什么必须机器守：这类写法 pnpm build 成功、零警告，页面上什么都不发生。
// 实测（2026-09-29）user 站有 42 处（text-primary 16 / bg-primary 15 / border-primary 11），
// 构建产物 CSS 里这三条规则一条都不存在。
//
// 这道闸门没有假阳性：命中即错——裸的 {utility}-{palette} 在任何情况下都不可能有规则。
// 它读的是 SSOT 的实际构造而非写死的名单，所以将来谁给某个色阶补了 DEFAULT，会自动放行。
//
// 用法: node scripts/check-classnames.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT, loadTokens, stripMeta } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');

if (!existsSync(SITES)) { console.log('check-classnames：本次工作区没有 sites/，跳过'); process.exit(0); }

const color = stripMeta(loadTokens().core.color);
const PALLETES = Object.keys(color).filter((k) => color[k] && typeof color[k] === 'object'
  && !Array.isArray(color[k]) && !Object.keys(color[k]).includes('DEFAULT'));
const PREFIXES = ['bg','text','border','ring','fill','stroke','from','to','via','divide','outline','decoration','placeholder','caret','shadow','accent'];

// 名字都是 [a-z-]，不含正则元字符，直接拼接即可。
// 左边界必须有：没有它，text-primary 会匹配到 --color-text-primary 里面去，
// 而那是 text-[var(--color-text-primary)] 这种**正确**写法（实测栽过这个跟头）。
const NEG = '(?<![a-zA-Z0-9_-])';
const NEG2 = '(?![a-zA-Z0-9_-])';
const RE = new RegExp(NEG + '(?:' + PREFIXES.join('|') + ')-(?:' + PALLETES.join('|') + ')' + NEG2, 'g');

const SKIPDIR = new Set(['node_modules','.git','dist','.astro','.next','public','build','coverage','generated']);
function walk(d, out) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (SKIPDIR.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (['.tsx','.jsx','.ts','.astro','.html','.mdx'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

const problems = [];
const perSite = [];
for (const site of readdirSync(SITES)) {
  const dir = join(SITES, site);
  if (!statSync(dir).isDirectory()) continue;
  const hits = [];
  for (const f of walk(dir, [])) {
    const rel = f.replace(/\\/g, '/');
    if (/\/packages\//.test(rel)) continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      const code = ln.replace(/\/\/.*$/, '');
      const m = code.match(RE);
      if (m) for (const cls of new Set(m)) hits.push({ cls, file: relative(SITES, f).replace(/\\/g, '/'), line: i + 1 });
    });
  }
  if (!hits.length) continue;
  const byCls = new Map();
  for (const h of hits) { if (!byCls.has(h.cls)) byCls.set(h.cls, []); byCls.get(h.cls).push(h); }
  perSite.push({ site, total: hits.length, classes: [...byCls.entries()].map(([c, v]) => ({ cls: c, n: v.length, first: v[0].file + ':' + v[0].line })) });
  for (const [cls, v] of byCls) {
    problems.push('K1 ' + site + '：' + cls + ' × ' + v.length + '（首处 ' + v[0].file + ':' + v[0].line + '）—— 色阶没有 DEFAULT 键，这个类生成不出来；应改用色阶档位（如 primary-600）或任意值 text-[var(--color-…)]');
  }
}

if (AS_JSON) console.log(JSON.stringify({ palettes: PALLETES, perSite, problems }, null, 2));
else {
  console.log('类名可达性闸门：无 DEFAULT 的色阶 = ' + PALLETES.join(', '));
  if (!perSite.length) console.log('\n结论：没有站点使用「生成不出来」的裸色阶类名');
  else {
    console.log('');
    for (const s of perSite) {
      console.log('  ' + s.site + '  共 ' + s.total + ' 处');
      for (const c of s.classes) console.log('      ' + c.cls.padEnd(20) + '× ' + String(c.n).padStart(3) + '   ' + c.first);
    }
    console.log('');
    for (const p of problems) console.log('  [ERROR] ' + p);
    console.log('结论：有 ' + problems.length + ' 种「写了但生成不出来」的类名');
  }
}
process.exit(problems.length ? 1 : 0);
