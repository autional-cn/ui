#!/usr/bin/env node
// build-cdn — 把设计系统的「运行期资产」发布成带版本号的不可变路径，供 cdn.autional.cn 托管。
//
// 为什么需要它（而不是让站点各自拷一份）：
//   ① Go 服务 demo 不是 Node 构建，装不了 npm，只能 <link href="https://cdn..."> 取预编译 CSS
//   ② favicon / logo 在此之前**完全没有交付通道**——ui/assets/ 只被文档引用，14 个站点是手工放置的
//   ③ 字体走同一个 URL 才能跨站命中缓存（14 个门户只下载一次，而不是 14 次）
//
// 输出布局（--out 指向 cdn 仓的工作区）：
//   <out>/ui/v<version>/manifest.json          每个文件的 path / bytes / sha384
//   <out>/ui/v<version>/tokens.css
//   <out>/ui/v<version>/primitives.css
//   <out>/ui/v<version>/fonts/*
//   <out>/ui/v<version>/icons/*                favicon 套件（含生成的 site.webmanifest）
//   <out>/ui/v<version>/logo/*
//   <out>/ui/latest.json                       当前版本指针（短 TTL）
//
// 版本化路径是硬要求：非版本化 + 长 TTL 会让配色改动卡在全站脏缓存里，且无法主动失效。
//
// 用法: node scripts/build-cdn.mjs [--out <dir>]

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadTokens, resolvedIn, parseHex } from './lib/tokens.mjs';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = resolve(outIdx >= 0 ? argv[outIdx + 1] : join(ROOT, '..', 'cdn'));
const CDN_ORIGIN = 'https://cdn.autional.cn';

const T = loadTokens();
const VERSION = T.$meta.version;
const BASE = '/ui/v' + VERSION;
const DEST = join(OUT, 'ui', 'v' + VERSION);
const ABS = CDN_ORIGIN + BASE;

// ── 源 → 目标 ───────────────────────────────────────────────────────────────
// 图标只保留一套。历史上并存两套（assets/favicon/png 与 assets/favicon_io），
// 二者内容不同、互有缺失：favicon_io 有 favicon.ico 与标准尺寸命名，favicon/png 有
// dark/light/mono 三个 512 变体。这里按用途取并集，而不是把两套都发出去——
// 发两套等于把「哪个才是对的」这个问题留给每个消费者。
const ICONS = [
  ['assets/favicon_io/favicon.ico', 'icons/favicon.ico'],
  ['assets/favicon_io/favicon-16x16.png', 'icons/favicon-16x16.png'],
  ['assets/favicon_io/favicon-32x32.png', 'icons/favicon-32x32.png'],
  ['assets/favicon/png/favicon-48x48.png', 'icons/favicon-48x48.png'],
  ['assets/favicon_io/apple-touch-icon.png', 'icons/apple-touch-icon.png'],
  ['assets/favicon_io/android-chrome-192x192.png', 'icons/android-chrome-192x192.png'],
  ['assets/favicon_io/android-chrome-512x512.png', 'icons/android-chrome-512x512.png'],
  ['assets/logo/favicon.svg', 'icons/favicon.svg'],
  ['assets/favicon/favicon-dark.svg', 'icons/favicon-dark.svg'],
  ['assets/favicon/favicon-light.svg', 'icons/favicon-light.svg'],
  ['assets/favicon/favicon-mono-black.svg', 'icons/favicon-mono-black.svg'],
  ['assets/favicon/favicon-mono-white.svg', 'icons/favicon-mono-white.svg'],
];
const LOGOS = [
  ['assets/logo/logo-mark.svg', 'logo/logo-mark.svg'],
  ['assets/logo/logo-mark.color.svg', 'logo/logo-mark.color.svg'],
  ['assets/logo/logo-mark.dark.svg', 'logo/logo-mark.dark.svg'],
  ['assets/logo/logo-mark.mono-black.svg', 'logo/logo-mark.mono-black.svg'],
  ['assets/logo/logo-mark.mono-white.svg', 'logo/logo-mark.mono-white.svg'],
];
const FONTS = [
  ['packages/tokens/fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-wght-normal.woff2'],
  ['packages/tokens/fonts/LICENSE-Inter-OFL.txt', 'fonts/LICENSE-Inter-OFL.txt'],
];
const CSS = [
  ['packages/tokens/tokens.css', 'tokens.css'],
  ['packages/tokens/primitives.css', 'primitives.css'],
];
// profiles 是**按站点**覆盖调色板的样式表（docs / developer）。此前只经 npm 下发，
// 站点从 @import '@autional-cn/tokens/profiles/x.css' 取；CDN 上没有它们，
// 于是「CDN 作为运行期唯一来源」这个前提不成立（少了它 Astro 站会变配色）。
const PROFILES = [
  ['packages/tokens/profiles/docs.css', 'profiles/docs.css'],
  ['packages/tokens/profiles/developer.css', 'profiles/developer.css'],
];

// ── 摊平 @layer ─────────────────────────────────────────────────────────────
// 为什么必须做：tokens.css 与 primitives.css 的顶层都是 @layer base/components { … }。
// 经 Tailwind/PostCSS 处理时，Tailwind 3 会把这些 @layer **摊平**成普通规则按序输出；
// 而 CDN 是**直接托管原文件**的，浏览器会按**原生 CSS 级联层**处理。两者优先级规则不同：
// 原生层内的规则**输给任何未分层的规则，且与选择器特异性无关**。
// 后果静默且严重：站点自己的 Tailwind 产物是未分层的，于是 preflight 的
// button { background-color: transparent } 会盖掉层内的 .brand-button —— 按钮背景没了。
// 摊平后 CDN 产物与站点经 Tailwind 得到的结果一致（层内顺序原样保留：base 先、components 后）。
function flattenLayers(css) {
  const re = /@layer\s+[a-zA-Z0-9_,\s-]+\s*\{/;
  let out = css;
  for (let guard = 0; guard < 16; guard++) {
    const m = re.exec(out);
    if (!m) break;
    const start = m.index;
    const open = start + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) break;
    out = out.slice(0, start) + out.slice(open + 1, end) + out.slice(end + 1);
  }
  return out;
}

// ── 生成 site.webmanifest ───────────────────────────────────────────────────
// 不从 favicon_io 直接拷：那份用的是相对路径，放到 CDN 上就成了死链。
// 这里按 CDN 绝对路径重新生成，theme_color 取自令牌（不是手填的心情值）。
const R = resolvedIn(T, {});
const brand = R['color.brand'] || R['color.primary-700'];
const bg = R['color.neutral-0'] || '#ffffff';
const manifestWeb = {
  name: 'Autional',
  short_name: 'Autional',
  icons: [
    { src: ABS + '/icons/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: ABS + '/icons/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
  ],
  theme_color: brand,
  background_color: bg,
  display: 'standalone'
};

// ── 构建 ────────────────────────────────────────────────────────────────────
if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

const entries = [];
const missing = [];

// manifest 里的 sha384 是对**即将被托管的精确字节**计算的，所以必须先确定字节，再算哈希。
// 这一步不是洁癖，是踩过的坑：ui/assets/ 下的 SVG 是 CRLF，本脚本原样拷过来并按 CRLF 算哈希，
// 而 git（core.autocrlf）与 Vercel 侧都是 LF —— 结果 22 个文件里 10 个 SVG 的 SRI 全部失配，
// 且失配是**静默**的：只有主动下载回来自校验才会发现。
// 因此文本产物在这里统一归一化为 LF，让产物与平台、与 git 配置解耦。
const TEXT_EXT = new Set(['.css', '.json', '.svg', '.txt', '.webmanifest', '.html', '.map', '.js', '.mjs', '.ts']);

function emit(srcRel, destRel, transform) {
  const src = join(ROOT, srcRel);
  if (!existsSync(src)) { missing.push(srcRel); return; }
  const dest = join(DEST, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  const ext = destRel.slice(destRel.lastIndexOf('.'));
  let buf;
  if (transform) {
    buf = Buffer.from(transform(readFileSync(src, 'utf8')), 'utf8');
  } else if (TEXT_EXT.has(ext)) {
    buf = Buffer.from(readFileSync(src, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
  } else {
    buf = readFileSync(src);
  }
  writeFileSync(dest, buf);
  entries.push({
    path: BASE + '/' + destRel.split('\\').join('/'),
    bytes: buf.length,
    sha384: 'sha384-' + createHash('sha384').update(buf).digest('base64')
  });
}

// 自我断言：摊平必须真的发生。第一版把正则在字符串里多转义了一层，写进文件的是匹配
// 字面反斜杠的 /@layer\\s+/，于是什么都没摊平——而 check-cdn 仍然全绿，
// 因为 manifest 与产物是一起生成的，闸门看不出「变换是空操作」。
// 「脚本报成功」必须等于「我要的结果发生了」，所以这里直接断言。
function emitCss(srcRel, destRel) {
  const src = join(ROOT, srcRel);
  if (!existsSync(src)) { missing.push(srcRel); return; }
  const raw = readFileSync(src, 'utf8');
  const flat = flattenLayers(raw);
  if (/@layer/.test(raw) && /@layer/.test(flat)) {
    console.error('摊平失败：' + srcRel + ' 仍含 @layer —— 变换没生效，拒绝产出语义不同的样式表');
    process.exit(1);
  }
  emit(srcRel, destRel, () => flat);
}
for (const [s, d] of CSS) emitCss(s, d);
for (const [s, d] of PROFILES) emitCss(s, d);
for (const [s, d] of FONTS) emit(s, d);
for (const [s, d] of ICONS) emit(s, d);
for (const [s, d] of LOGOS) emit(s, d);
emit('assets/favicon_io/site.webmanifest', 'icons/site.webmanifest', () => JSON.stringify(manifestWeb, null, 2) + '\n');

if (missing.length) {
  console.error('缺少源文件，构建中止（宁可失败也不发一份不完整的资产包）：');
  for (const m of missing) console.error('  ' + m);
  process.exit(1);
}

entries.sort((a, b) => (a.path < b.path ? -1 : 1));
const manifest = {
  $note: 'CDN 资产清单。sha384 用于 <link>/<script> 的 integrity 属性与 SRI 校验。路径一律不可变：内容变了必须换版本号。',
  version: VERSION,
  base: BASE,
  origin: CDN_ORIGIN,
  generatedFrom: 'autional-cn/ui',
  files: entries
};
writeFileSync(join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

mkdirSync(join(OUT, 'ui'), { recursive: true });
writeFileSync(join(OUT, 'ui', 'latest.json'), JSON.stringify({
  $note: '当前版本指针。TTL 短（300s），因为它是可变的；所有 v<version>/ 下的路径才是不可变的。',
  version: VERSION,
  base: BASE
}, null, 2) + '\n');

// ── 人可读的目录页 ──────────────────────────────────────────────────────────
// cdn.autional.cn 的裸根应该是一个能用的落点，而不是 404 或文件列表。
// 它同时是 Go 服务 demo 与各类「非 Node 构建」消费方的接入说明。
const rows = entries.map((e) => {
  const rel = e.path.replace(BASE + '/', '');
  return '<tr><td><a href="' + e.path + '">' + rel + '</a></td><td class="n">' + e.bytes +
         '</td><td class="h">' + e.sha384.slice(0, 22) + '…</td></tr>';
}).join('\n');

const SNIPPETS = [
  ['预编译令牌 CSS（Go demo / 任何非 Node 构建的消费方）',
   '<link rel="stylesheet" href="' + ABS + '/tokens.css">'],
  ['字体（跨站共用同一 URL 才会命中同一份缓存）',
   '<link rel="preload" as="font" type="font/woff2" crossorigin\n      href="' + ABS + '/fonts/inter-latin-wght-normal.woff2">'],
  ['站点图标套件（5 条 link，含 32x32 与 apple-touch）',
   '<link rel="icon" href="' + ABS + '/icons/favicon.ico" sizes="any">\n' +
   '<link rel="icon" type="image/png" sizes="32x32" href="' + ABS + '/icons/favicon-32x32.png">\n' +
   '<link rel="icon" type="image/png" sizes="16x16" href="' + ABS + '/icons/favicon-16x16.png">\n' +
   '<link rel="apple-touch-icon" sizes="180x180" href="' + ABS + '/icons/apple-touch-icon.png">\n' +
   '<link rel="icon" type="image/svg+xml" href="' + ABS + '/icons/favicon.svg">\n' +
   '<link rel="manifest" href="' + ABS + '/icons/site.webmanifest">'],
  ['构建期代码（Node / Vite / Astro）—— 走 npm，不要走 CDN',
   'pnpm add @autional-cn/tokens @autional-cn/tailwind-preset\n' +
   "import '@autional-cn/tokens/tokens.css'"]
];
const snippetHtml = SNIPPETS.map(([t, code]) =>
  '<h3>' + t + '</h3><pre><code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code></pre>').join('\n');

const html = [
  '<!doctype html>',
  '<html lang="zh-CN"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Autional CDN — 设计系统运行期资产</title>',
  '<style>',
  'body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1e293b}',
  'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}',
  'h3{font-size:14px;margin:18px 0 6px;color:#334155}',
  'code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}',
  'pre{background:#f7fafd;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;overflow-x:auto}',
  'table{border-collapse:collapse;width:100%;font-size:13px}',
  'th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #eef2f6}',
  '.n,.h{text-align:right;color:#64748b;font-family:ui-monospace,monospace;font-size:12px}',
  'a{color:#004565}',
  '.warn{background:#fffcf0;border:1px solid #ffefb3;border-radius:6px;padding:10px 12px;margin:16px 0}',
  '</style></head><body>',
  '<h1>Autional CDN</h1>',
  '<p>设计系统的<strong>运行期资产</strong>。构建期代码（令牌 JS、Tailwind preset、antd 主题桥、React 组件）请走 npm，不要走这里。</p>',
  '<div class="warn"><strong>路径不可变。</strong>内容一旦变化就换版本号——<code>' + BASE + '/</code> 下的文件永久缓存，不保证会被刷新。需要跟随最新版时读 <a href="/ui/latest.json"><code>/ui/latest.json</code></a>（短 TTL）。</div>',
  '<p>当前版本 <strong>' + VERSION + '</strong> · 共 ' + entries.length + ' 个文件</p>',
  '<h2>接入片段</h2>',
  snippetHtml,
  '<h2>清单</h2>',
  '<p><a href="' + ABS + '/manifest.json">manifest.json</a> — 每个文件的字节数与 sha384，可用于 SRI 与完整性校验。</p>',
  '<table><thead><tr><th>路径</th><th class="n">字节</th><th class="h">sha384</th></tr></thead><tbody>',
  rows,
  '</tbody></table>',
  '<p style="margin-top:32px;color:#8896a6;font-size:12px">由 <code>autional-cn/ui</code> 的 <code>scripts/build-cdn.mjs</code> 生成，请勿手工编辑。</p>',
  '</body></html>'
].join('\n') + '\n';
writeFileSync(join(OUT, 'index.html'), html);

const total = entries.reduce((n, e) => n + e.bytes, 0);
console.log('CDN 构建完成');
console.log('  输出   ' + OUT);
console.log('  版本   ' + VERSION + '  (' + BASE + ')');
console.log('  文件   ' + entries.length + ' 个 / ' + (total / 1024).toFixed(1) + ' KB');
console.log('  入口   ' + ABS + '/tokens.css');
console.log('  字体   ' + ABS + '/fonts/inter-latin-wght-normal.woff2');
console.log('  图标   ' + ABS + '/icons/favicon.svg');
console.log('  主题色 site.webmanifest theme_color = ' + brand + '（取自令牌）');
