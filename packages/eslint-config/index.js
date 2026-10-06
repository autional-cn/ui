// @autional/eslint-config —— 全舰队共享的 ESLint flat config。
//
// 为什么要有它：2026-10-04 实测，四个在册门户的 package.json 里都写着 "lint": "eslint src/"，
// 但**全舰队没有一份 ESLint 配置、也没有任何一处把 eslint 声明成依赖** ——
// `pnpm exec eslint` 解析到的是上层目录里**别的项目**装的那一份（D:\\deepseek-harness\\node_modules\\...），
// 再因为找不到配置而以 2 退出。也就是说这条命令从来没在本仓跑过，它只是一个名字。
//
// 与 @autional/tsconfig 同一个形状：**规则只有一个来源**，站点那边只留三行。
//
// ── 为什么首次引入不用「全 error」 ──────────────────────────────────────
// 首轮实测（recommended 全家桶）：四个门户共 1156 条，其中
//   @typescript-eslint/no-explicit-any   819
//   @typescript-eslint/no-unused-vars    328
//   react-hooks/exhaustive-deps            9
// 把 1156 条一次性变成红，唯一的现实结果是所有人学会加 eslint-disable ——
// 那比没有 lint 更糟（注释会被当成豁免，而豁免是不受审计的）。
// 所以按舰队一路用的**登记制**：这两条先降为 warn 并由闸门棘轮看着（只许减不许增），
// 其余 recommended 规则**保持 error** —— 那部分才是真正会抓到新 bug 的（no-undef / no-unreachable /
// no-dupe-keys / no-cond-assign…）。闸门要求 error **必须为 0**，warn 不得超过台账。
//
// 降为 warn 的两条都有明确理由，不是「太吵了就关掉」：
//   · no-explicit-any —— any 在本仓有既成用法（antd 泛型、测试替身），且它**不是正确性问题**；
//   · no-unused-vars —— 大量命中来自「解构剔除」这一写法（const { a, b, ...rest } = x），
//     那是有意的，靠 ignoreRestSiblings 放行之后剩下的才是真死代码。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
	{
		ignores: [
			'**/dist/**',
			'**/node_modules/**',
			'**/public/**',
			'**/coverage/**',
			'**/storybook-static/**',
			'**/*.config.js',
			'**/*.config.mjs',
			'**/*.config.ts',
			'**/*.d.ts',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
		// flat config 里插件必须显式登记：只写 rules 里的 'react-hooks/…' 而不注册插件，
		// ESLint 会把它当成「规则不存在」并**报成 error**（实测踩到 —— 5+3 条假红）。
		plugins: { 'react-hooks': reactHooks },
		languageOptions: {
			parserOptions: { ecmaFeatures: { jsx: true } },
		},
		rules: {
			// TS 自己就能判未定义标识符，交给它；开着重叠报错只会制造噪音
			'no-undef': 'off',
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrors: 'none',
					// 解构剔除（const { a, ...rest } = x）是有意写法，不该算未使用
					ignoreRestSiblings: true,
				},
			],
			// React 的两条只开经典的两条，**不整包引 recommended**：
			// 插件 v7 的 recommended 里还有一长串新规则（set-state-in-effect / purity / immutability…），
			// 一次性全开会把「引入 lint」变成「引入一次重构」。rules-of-hooks 是能抓到真 bug 的那条，留在 error；
			// exhaustive-deps 按插件自己的传统是 warn —— 而且本仓已经有 8 处
			// `// eslint-disable-next-line react-hooks/exhaustive-deps` 注释（在插件缺席的年代写的，
			// 那时它只会报「规则不存在」；装上插件之后这些注释才真正开始起作用）。
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn',
		},
	},
	{
		// 测试与 story 里 any 是正常工具（造替身、造边界数据）
		files: ['**/__tests__/**', '**/*.test.*', '**/*.stories.*', '**/test/**'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
		},
	},
);
