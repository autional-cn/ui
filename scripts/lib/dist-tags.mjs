// dist-tags — 发布通道的 tag 政策（2026-10-02 新增，见计划文末「规则 2」）。
//
// 为什么需要它：@autional-cn/shared 连发多次只打了 rc 没跟 latest，
// 于是 latest 停在 0.1.0-rc.4 而 rc 已到 0.1.0-rc.10 —— 任何人 npm i @autional-cn/shared
// 都会装到几天前的构建。站点是精确 pin 所以没受影响，**这正是它危险的地方：
// 一条通道坏了，另一条通道掩盖了它。**
//
// 政策：rc 是舰队通道；latest 必须等于 rc。
// 闸门（check-publish）与修复器（align-dist-tags）共用本模块，避免两处实现漂开。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './tokens.mjs';

export const PACKAGES = [
  '@autional-cn/tokens',
  '@autional-cn/tailwind-preset',
  '@autional-cn/ui',
  '@autional-cn/shared',
  '@autional-cn/react',
  '@autional-cn/tsconfig'
];
export const PKG_DIR = {
  '@autional-cn/tokens': 'packages/tokens',
  '@autional-cn/tailwind-preset': 'packages/tailwind-preset',
  '@autional-cn/ui': 'packages/ui',
  '@autional-cn/shared': 'packages/shared',
  '@autional-cn/react': 'packages/react',
  '@autional-cn/tsconfig': 'packages/tsconfig'
};
export const versionOf = (pkg) => JSON.parse(readFileSync(join(ROOT, PKG_DIR[pkg], 'package.json'), 'utf8')).version;

// 默认 registry 必须显式写出来：本机 ~/.npmrc 指向镜像站，而镜像站对新发布的包有同步延迟。
// 闸门在临时目录里跑，项目级 .npmrc 作用不到（实测：shared@0.1.0-rc.10 在 npmjs 上可下载，
// 走镜像的闸门却报 No matching version found）。见计划文末「规则 3」。
export const REGISTRY = 'https://registry.npmjs.org/';

export async function fetchDistTags(pkg) {
  const url = REGISTRY + '-/package/' + pkg.replace('/', '%2f') + '/dist-tags';
  let r;
  try {
    r = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    // 把底层错误码带进 message：Node 的 fetch 失败只给一句 "fetch failed"，
    // 而 check-publish 靠错误码判断「连不上 registry」（SKIP）还是「连上了但内容不对」（FAIL）。
    // 不带上就会把「没验」误报成「不达标」。
    const code = (e && e.cause && e.cause.code) || e.code || 'network';
    throw new Error(pkg + ' 的 dist-tags 拉取失败（' + code + '，network）：' + (e.message || e));
  }
  if (!r.ok) throw new Error(pkg + ' 的 dist-tags 返回 ' + r.status);
  return r.json();
}

// 返回 { problems: [], infos: [], states: [] }。只做判断，不改动。
export async function auditDistTags() {
  const problems = [];
  const infos = [];
  const states = [];
  for (const pkg of PACKAGES) {
    const local = versionOf(pkg);
    let tags;
    try { tags = await fetchDistTags(pkg); }
    catch (e) { problems.push(pkg + '：读不到 dist-tags（' + e.message + '）'); continue; }
    const rc = tags.rc || null;
    const latest = tags.latest || null;
    states.push({ pkg, local, rc, latest });
    if (!rc) {
      problems.push(pkg + '：没有 rc tag（评测通道未建立）。当前 tags=' + JSON.stringify(tags));
      continue;
    }
    if (rc !== local) {
      // 本地比 rc 新说明「改了没发」，比 rc 旧说明「发过又回退」，两者都要人看。
      problems.push(pkg + '：rc tag 指向 ' + rc + '，而本地 SSOT 是 ' + local + ' —— 发布通道与源码不同步');
    }
    if (latest !== rc) {
      problems.push(pkg + '：latest=' + latest + ' 而 rc=' + rc +
        ' —— 政策要求 latest 必须等于 rc（否则 npm i 不带 tag 的人会装到旧版本）。修：pnpm dist-tags:align');
    } else {
      infos.push(pkg + '：latest == rc == ' + rc);
    }
  }
  return { problems, infos, states };
}
