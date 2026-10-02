#!/usr/bin/env node
// bump-cdn-version — 把 14 个站点的 CDN 引用切到当前版本目录。
// 用法:
//   node scripts/bump-cdn-version.mjs           # 只报告会改什么（默认，不写盘）
//   node scripts/bump-cdn-version.mjs --write   # 实际写入
//
// 为什么需要它：CDN 版本目录名带内容指纹（见 build-cdn.mjs），所以 tokens 一改、
// 目录名就变，而运行期资产的唯一引用方是 14 个站点的 <link>/<script>。
// 手工改 14 个仓是这类改动最容易漏一部分的地方——而漏掉的那一站会静默地留在旧版本上
// （旧目录已被 build-cdn 清掉，它的 URL 会 404）。
// check-icons 的 I19（14 站版本必须相同）是这条的守门人，本脚本是配套的施工工具。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const WRITE = process.argv.includes('--write');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const CDN = process.env.AUTIONAL_CDN_DIR || resolve(ROOT, '..', 'cdn');

const latestPath = join(CDN, 'ui', 'latest.json');
if (!existsSync(latestPath)) {
  console.error('找不到 ' + latestPath + ' —— 先跑 node scripts/build-cdn.mjs');
  process.exit(1);
}
const WANT = JSON.parse(readFileSync(latestPath, 'utf8')).version;
if (!/^.+\.([0-9a-f]{8})$/.test(WANT)) {
  console.error('latest.json 的版本 ' + WANT + ' 里没有内容指纹 —— 先跑 build-cdn.mjs 重建');
  process.exit(1);
}

const EXT = new Set(['.html', '.astro', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.json', '.md', '.mdx', '.txt', '.yaml', '.yml', '.vue', '.svelte']);
const SKIP_DIR = /(^|[\\/])(node_modules|dist|\.git|\.astro|\.next|build|coverage)([\\/]|$)/;
// 只改 CDN 运行期资产路径。构建期代码走 npm，与这里无关。
const RE = /(https:\/\/cdn\.autional\.cn\/ui\/)v([^\/"''\s]+)(\/)/g;

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const report = [];
let totalFiles = 0;
let totalHits = 0;
const staleVersions = new Set();

for (const site of existsSync(SITES) ? readdirSync(SITES).sort() : []) {
  const root = join(SITES, site);
  if (!statSync(root).isDirectory()) continue;
  const hits = [];
  for (const f of walk(root, [])) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('cdn.autional.cn/ui/')) continue;
    let n = 0;
    const next = src.replace(RE, (m, head, ver, tail) => {
      if (ver === WANT) return m;
      n++;
      staleVersions.add(ver);
      return head + 'v' + WANT + tail;
    });
    if (n) { hits.push({ f: relative(root, f).replace(/\\/g, '/'), n, next, src }); totalFiles++; totalHits += n; }
  }
  if (hits.length) report.push({ site, hits });
}

console.log('CDN 当前版本：' + WANT);
if (!report.length) {
  console.log('14 个站点都已指向该版本，无需改动。');
  process.exit(0);
}
console.log('发现旧版本引用：' + [...staleVersions].join(', '));
for (const r of report) {
  console.log('  ' + r.site + '  ' + r.hits.reduce((a, h) => a + h.n, 0) + ' 处 / ' + r.hits.length + ' 个文件');
  for (const h of r.hits) console.log('      ' + h.f + '  ×' + h.n);
}
console.log('合计 ' + totalHits + ' 处，' + totalFiles + ' 个文件');

if (!WRITE) {
  console.log('\n（预演。加 --write 实际写入。）');
  process.exit(0);
}

let written = 0;
for (const r of report) {
  for (const h of r.hits) {
    writeFileSync(join(SITES, r.site, h.f), h.next);
    if (readFileSync(join(SITES, r.site, h.f), 'utf8') === h.src) {
      console.error('自证失败：' + r.site + '/' + h.f + ' 写入后内容未变');
      process.exit(1);
    }
    written++;
  }
}

// 自证：写完之后，全舰队不得再有任何非当前版本的 CDN 引用。
const leftovers = [];
for (const site of readdirSync(SITES)) {
  const root = join(SITES, site);
  if (!statSync(root).isDirectory()) continue;
  for (const f of walk(root, [])) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/cdn\.autional\.cn\/ui\/v([^\/"'\s]+)\//g)) {
      if (m[1] !== WANT) leftovers.push(site + '/' + relative(root, f).replace(/\\/g, '/') + ' -> v' + m[1]);
    }
  }
}
if (leftovers.length) {
  console.error('自证失败，仍有旧版本引用：');
  for (const l of leftovers) console.error('  ' + l);
  process.exit(1);
}
console.log('\n已写入 ' + written + ' 个文件；自证：全舰队 0 处旧版本引用。');
