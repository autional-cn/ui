#!/usr/bin/env node
// CDN 资产契约闸门（verify 第 9 道）
//
// 它守三件事，每一件都对应一种「静默失败」：
//   ① vercel.json 的响应头契约 —— 少了 CORS，跨域 @font-face 会**静默回退**系统字体；
//      少了 immutable，改配色会卡在全站脏缓存里且无法主动失效
//   ② manifest.json 的 sha384 与产物字节一致 —— 首次发布时 22 个文件里有 10 个失配，
//      原因是 CRLF/LF 归一化，而**没有任何东西会发现**，除非主动回验
//   ③ 版本化路径确实不可变、latest 指针 TTL 确实短
//
// 本地模式（默认）：只校验仓内文件与配置，不联网。ci 里只 checkout ui/ 时自动跳过。
// 线上模式（--live）：把每个文件下载回来重算哈希，并断言真实响应头。需要网络。
//
// 用法: node scripts/check-cdn.mjs [--cdn <dir>] [--live]

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/tokens.mjs';

const argv = process.argv.slice(2);
const cdnIdx = argv.indexOf('--cdn');
const CDN = resolve(cdnIdx >= 0 ? argv[cdnIdx + 1] : join(ROOT, '..', 'cdn'));
const LIVE = argv.includes('--live');
const ORIGIN = 'https://cdn.autional.cn';

const problems = [];
const infos = [];
const bad = (m) => problems.push(m);

if (!existsSync(CDN)) {
  console.log('CDN 仓工作区不存在（' + CDN + '）——跳过。CI 里只 checkout ui/ 时属正常。');
  process.exit(0);
}

// ── ① 响应头契约 ────────────────────────────────────────────────────────────
const vjPath = join(CDN, 'vercel.json');
if (!existsSync(vjPath)) {
  bad('缺少 vercel.json —— CORS 与缓存契约没有任何一条被声明');
} else {
  let vj = null;
  try { vj = JSON.parse(readFileSync(vjPath, 'utf8')); } catch (e) { bad('vercel.json 不是合法 JSON：' + e.message); }
  if (vj) {
    const rules = Array.isArray(vj.headers) ? vj.headers : [];
    const findHeader = (pred, key) => {
      for (const r of rules) {
        if (!pred(String(r.source || ''))) continue;
        for (const h of (r.headers || [])) if (h.key.toLowerCase() === key.toLowerCase()) return String(h.value);
      }
      return null;
    };
    // 全局 CORS：必须有一条覆盖所有路径的 Access-Control-Allow-Origin: *
    const cors = findHeader((s) => s === '/(.*)' || s === '/:path*' || s === '/(.*)', 'Access-Control-Allow-Origin');
    if (cors !== '*') bad('vercel.json 缺少全局 Access-Control-Allow-Origin: *（跨域 @font-face 缺此头会静默回退系统字体，且极难排查）。当前值：' + cors);
    else infos.push('CORS：全局 Access-Control-Allow-Origin: *');

    // 版本化路径必须 immutable
    const cc = findHeader((s) => s.indexOf(':version') >= 0, 'Cache-Control') || findHeader((s) => s.indexOf('/ui/') >= 0, 'Cache-Control');
    if (!cc || cc.indexOf('immutable') < 0) bad('vercel.json 没有给版本化路径声明 Cache-Control: immutable。当前值：' + cc);
    else if (cc.indexOf('31536000') < 0) bad('版本化路径的 max-age 不是一年：' + cc);
    else infos.push('版本化路径：' + cc);

    // latest 指针 TTL 必须短
    const latestCc = findHeader((s) => s.indexOf('latest') >= 0, 'Cache-Control');
    if (!latestCc) bad('vercel.json 没有给 /ui/latest.json 声明短 TTL —— 它是唯一的可变指针，长缓存会让「跟随最新版」失真');
    else {
      const m = latestCc.match(/max-age=(\d+)/);
      const age = m ? parseInt(m[1], 10) : null;
      if (age === null || age > 600) bad('/ui/latest.json 的 max-age 应 <= 600，当前：' + latestCc);
      else infos.push('latest 指针：' + latestCc);
    }
  }
}

// ── ② manifest 与产物字节一致 ───────────────────────────────────────────────
const uiDir = join(CDN, 'ui');
let manifest = null;
let manifestPath = null;
if (!existsSync(uiDir)) {
  bad('CDN 仓里没有 ui/ 目录 —— 还没跑过 pnpm build:cdn');
} else {
  const latestPath = join(uiDir, 'latest.json');
  if (!existsSync(latestPath)) bad('缺少 ui/latest.json');
  else {
    const latest = JSON.parse(readFileSync(latestPath, 'utf8'));
    manifestPath = join(uiDir, 'v' + latest.version, 'manifest.json');
    if (!existsSync(manifestPath)) bad('latest.json 指向 v' + latest.version + '，但该版本的 manifest.json 不存在');
    else manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }
}

if (manifest) {
  let checked = 0;
  for (const f of manifest.files) {
    // manifest 里的 path 形如 /ui/v<version>/xxx，映射回仓内文件
    const rel = f.path.replace(/^\/ui\//, '');
    const abs = join(uiDir, rel);
    if (!existsSync(abs)) { bad('manifest 列了 ' + f.path + '，但仓里没有这个文件'); continue; }
    const buf = readFileSync(abs);
    const sha = 'sha384-' + createHash('sha384').update(buf).digest('base64');
    if (buf.length !== f.bytes) bad(f.path + ' 字节数不符：仓内 ' + buf.length + ' / 清单 ' + f.bytes);
    else if (sha !== f.sha384) bad(f.path + ' sha384 不符 —— 清单描述的不是实际字节（行尾转换是常见原因）');
    else checked++;
  }
  infos.push('manifest 字节校验：' + checked + '/' + manifest.files.length + ' 个文件与清单一致');

  // 版本化路径必须带版本号，不能出现「无版本」的发布
  const badPath = manifest.files.filter((f) => !/^\/ui\/v[^/]+\//.test(f.path));
  if (badPath.length) bad('有 ' + badPath.length + ' 个文件不在版本化路径下（例如 ' + badPath[0].path + '）—— 不可变缓存的前提是路径带版本号');
}

// ── ③ CDN 产物是否与**当前 SSOT** 一致 ────────────────────────────────────
// 这一段是补上一个实际发生过的缺口：令牌侧改了半个多月，而 CDN 还是旧的——
// 而当时 15 道闸门**全绿**。因为本闸门原本只校验「已发布内容与自己的 manifest 一致」，
// 不校验「manifest 与当前 SSOT 一致」。前者回答「发布出去的有没有坏」，
// 后者回答「发布出去的还是不是最新的」。两个问题不同，缺了后者就会静默落后。
//
// 做法就是「生成物一致性」的 CDN 版：把当前 SSOT 重新构建到一个临时目录，
// 与已发布的 manifest 逐文件比 sha384。
if (manifest && !LIVE) {
  const tmp = mkdtempSync(join(tmpdir(), 'cdn-freshness-'));
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-cdn.mjs'), '--out', tmp], { stdio: 'pipe' });
    const freshPath = join(tmp, 'ui', 'v' + manifest.version, 'manifest.json');
    if (!existsSync(freshPath)) bad('用当前 SSOT 重新构建后没有产出 v' + manifest.version + ' 的 manifest —— 版本号可能已变，CDN 需要重新发布');
    else {
      const fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
      const freshByPath = new Map(fresh.files.map((f) => [f.path, f]));
      // 路径前缀从 manifest 自己带的 base 取，不要引用 build-cdn.mjs 里的常量
      // （第一版写成了 BASE，那个变量只存在于 build-cdn.mjs —— 运行时才炸）。
      const strip = (p) => String(p).replace(/^\/ui\/v[^/]+\//, '');
      const stale = [];
      const missingInFresh = [];
      for (const f of manifest.files) {
        const g = freshByPath.get(f.path);
        if (!g) { missingInFresh.push(f.path); continue; }
        if (g.sha384 !== f.sha384) stale.push(strip(f.path));
      }
      const added = fresh.files.filter((f) => !manifest.files.some((o) => o.path === f.path)).map((f) => strip(f.path));
      if (stale.length) {
        bad('CDN 落后于当前 SSOT：' + stale.length + ' 个文件的 sha384 与重新构建的结果不一致 —— ' + stale.slice(0, 6).join(', ') +
            (stale.length > 6 ? ' …' : '') + '。重新发布：node scripts/build-cdn.mjs 然后在 ../cdn 提交推送');
      }
      if (added.length) bad('当前 SSOT 会多产出 ' + added.length + ' 个文件，CDN 里没有：' + added.slice(0, 6).join(', '));
      if (missingInFresh.length) bad('CDN 里有 ' + missingInFresh.length + ' 个文件当前 SSOT 已不再产出：' + missingInFresh.slice(0, 6).join(', '));
      if (!stale.length && !added.length && !missingInFresh.length) {
        infos.push('CDN 与当前 SSOT 一致（' + manifest.files.length + ' 个文件重新构建后逐字节相同）');
      }
    }
  } catch (e) {
    bad('无法用当前 SSOT 重新构建以比对：' + String(e.message || e).slice(0, 160));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── ④ 线上回验（可选）──────────────────────────────────────────────────────
if (LIVE) {
  // 区分两种失败，否则这道闸门会变成噪声：
  //   「连不上网」是环境条件（本机 Node 出网被重置；PowerShell 能通，同一台机器同一时刻）
  //   「连上了但契约不对」才是缺陷，必须失败
  // 所以：网络层异常 → SKIP（明确打印，不冒充通过）；拿到响应但头/字节不对 → FAIL。
  let networkDown = false;
  const get = async (url, method) => {
    try {
      return await fetch(url, { method: method || 'GET', redirect: 'follow' });
    } catch (e) {
      networkDown = true;
      throw e;
    }
  };
  try {
    const probes = [
      { url: ORIGIN + '/ui/v' + (manifest ? manifest.version : '0.1.0-rc') + '/tokens.css', expect: 'tokens.css' },
      { url: ORIGIN + '/ui/v' + (manifest ? manifest.version : '0.1.0-rc') + '/fonts/inter-latin-wght-normal.woff2', expect: 'woff2' }
    ];
    for (const p of probes) {
      const r = await get(p.url, 'HEAD');
      if (!r.ok) { bad('线上 ' + p.url + ' 返回 ' + r.status); continue; }
      const cors = r.headers.get('access-control-allow-origin');
      const cc = r.headers.get('cache-control') || '';
      if (cors !== '*') bad('线上 ' + p.expect + ' 的 Access-Control-Allow-Origin = ' + cors + '（应为 *）');
      if (cc.indexOf('immutable') < 0) bad('线上 ' + p.expect + ' 的 Cache-Control 不含 immutable：' + cc);
    }
    const lr = await get(ORIGIN + '/ui/latest.json', 'HEAD');
    if (lr.ok) {
      const cc = lr.headers.get('cache-control') || '';
      const m = cc.match(/max-age=(\d+)/);
      if (!m || parseInt(m[1], 10) > 600) bad('线上 /ui/latest.json 的 TTL 过长：' + cc);
    } else bad('线上 /ui/latest.json 返回 ' + lr.status);
    // 全量 SRI 回验
    if (manifest) {
      let ok = 0;
      for (const f of manifest.files) {
        const r = await get(ORIGIN + f.path);
        if (!r.ok) { bad('线上 ' + f.path + ' 返回 ' + r.status); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        const sha = 'sha384-' + createHash('sha384').update(buf).digest('base64');
        if (sha === f.sha384 && buf.length === f.bytes) ok++;
        else bad('线上 SRI 失配：' + f.path + '（字节 ' + buf.length + ' vs ' + f.bytes + '）');
      }
      infos.push('线上 SRI 回验：' + ok + '/' + manifest.files.length);
    }
  } catch (e) {
    if (networkDown) {
      infos.push('线上回验：SKIP —— 本进程无法出网（' + e.message + '）。这不是通过，是没验。' +
                 '改用 PowerShell 的 Invoke-WebRequest，或在 CI 里跑。');
    } else {
      bad('线上回验失败：' + e.message);
    }
  }
}

for (const i of infos) console.log('  [INFO ] ' + i);
for (const p of problems) console.log('  [ERROR] ' + p);
if (problems.length === 0) {
  const skipped = infos.some((i) => i.indexOf('SKIP') >= 0);
  console.log('结论：CDN 资产契约通过' + (LIVE ? (skipped ? '（本地部分通过；线上回验被跳过——见上，不要当成已验）' : '（含线上回验）') : '（本地；加 --live 做线上回验）'));
  process.exit(0);
}
console.log('结论：CDN 资产契约有 ' + problems.length + ' 项不达标');
process.exit(1);
