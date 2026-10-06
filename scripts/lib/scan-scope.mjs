// scan-scope —— 「什么算站点的源码」的**唯一来源**。
//
// 为什么要有这个文件（第 56 轮实测，代价：3 道闸门同时假红）：
//   8 道闸门各自抄过一份 SKIPDIR，其中 5 份漏了 `storybook-static` ——
//   那是 `pnpm build-storybook` 的产物、且已在 .gitignore 里。
//   于是本地跑一次 storybook 构建之后：
//     · check-colors     报 31 个「与令牌近似的色值」，全部来自 Storybook 自带的 UI bundle
//     · check-consistency 报「user 新增了 4 个 antd RangePicker 入口」—— 那是**编译后的 story 产物**
//     · check-token-tiers 报 user 的阴影从 25 涨到 79
//   三条都不是真的：判据看的是「源码」，不是「构建产物」。
//
// 这与本项目反复踩的那条同型：**同一个值不该有多个来源**。
// 判据的范围也是值 —— 抄 8 份，就一定有 5 份会腐。

/** 构建产物目录：永远不是源码。各闸门请在 `makeSkip(自己的额外项)` 里加，不要再手抄。 */
export const ARTIFACT_DIRS = new Set([
  'node_modules', '.git', 'dist', '.astro', '.next',
  'build', 'coverage', 'generated', '.turbo',
  'storybook-static', '.storybook-static', 'out',
  '.vercel', '.cache', '.output',
]);

/** 生成物/外部产物（按站点约定）：与 ARTIFACT_DIRS 的区别是它可能被某些站当源码树用，
 *  所以**要显式加**才排除（例如色值闸门要排除 `public`，图标闸门不排）。 */
export const GENERATED_DIRS = ['wiki-src', 'public'];

export const makeSkip = (...extra) => new Set([...ARTIFACT_DIRS, ...extra.filter(Boolean)]);

/** 测试与 story：里面的类名/色值是**断言字符串**，不是渲染出来的东西。 */
export const TEST_RE = /(\.|\/)(test|spec)\.[tj]sx?$|__tests__|__mocks__|\.stories\.[tj]sx?$/;

/** 源码扩展名：各闸门口径一致。 */
export const SRC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.astro', '.vue', '.svelte']);
