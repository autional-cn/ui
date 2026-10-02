#!/usr/bin/env node
// align-dist-tags — 把每个包的 latest 对齐到 rc（政策见计划文末「规则 2」）。
// 用法:
//   node scripts/align-dist-tags.mjs            # 只报告（默认）
//   node scripts/align-dist-tags.mjs --write    # 实际改 tag
//
// 为什么不是「发版时顺手做」：实测 shared 的 latest 落后 6 个版本而 rc 是对的，
// 且站点全部精确 pin —— 所以没有任何闸门或站点会报错，它可以一直错下去。

import { execFileSync } from 'node:child_process';
import { auditDistTags, REGISTRY } from './lib/dist-tags.mjs';

const WRITE = process.argv.includes('--write');

const { problems, infos, states } = await auditDistTags();

console.log('dist-tag 政策：latest 必须等于 rc');
for (const s of states) {
  const ok = s.rc && s.latest === s.rc;
  console.log('  ' + (ok ? 'OK  ' : 'DRIFT') + '  ' + s.pkg +
    '  本地=' + s.local + '  rc=' + (s.rc || '(无)') + '  latest=' + (s.latest || '(无)'));
}
for (const i of infos) console.log('  [INFO ] ' + i);
for (const p of problems) console.log('  [ERROR] ' + p);

const drift = states.filter((s) => s.rc && s.latest !== s.rc);
if (!WRITE) {
  console.log(drift.length ? '\n' + drift.length + ' 个包需要对齐。（预演，加 --write 实际改。）' : '\n无需对齐。');
  process.exit(0);
}

let fixed = 0;
for (const s of drift) {
  execFileSync('npm', ['dist-tag', 'add', s.pkg + '@' + s.rc, 'latest', '--registry=' + REGISTRY],
    { stdio: 'inherit', shell: process.platform === 'win32' });
  fixed++;
}
console.log('\n已对齐 ' + fixed + ' 个包。回验：');
const after = await auditDistTags();
for (const s of after.states) console.log('  ' + s.pkg + '  rc=' + s.rc + '  latest=' + s.latest);
if (after.problems.length) {
  console.error('\n自证失败，仍有问题：');
  for (const p of after.problems) console.error('  ' + p);
  process.exit(1);
}
console.log('自证通过：全部 latest == rc。');
