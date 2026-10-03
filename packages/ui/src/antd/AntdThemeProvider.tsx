'use client';

// AntdThemeProvider —— antd 与设计系统令牌之间的**唯一**桥。
//
// 为什么放在这里，而不是让每个站点各写一份：
//   在此之前，三个控制台各有一份 lib/antd-app.tsx，逻辑相同（ConfigProvider + 中英 locale
//   + dark 算法 + @autional-cn/tokens/antd-theme 的 token）。四份同构代码就是四份会各自漂移的东西。
//   这一份是它的唯一实现；站点只挂 Provider，不 import antd。
//
// 为什么单独一个子路径入口（@autional-cn/ui/antd）而不是并进根入口：
//   根入口的消费方里有不吃 antd 的（user 之前是、5 个 Astro 站也是）。
//   把 antd 并进根入口，等于让所有人替一个他们不用的库付包体积。
//   所以：antd 是**可选** peerDependency，默认入口 0 处 import antd（有闸门断言）。

import { useEffect, useMemo } from 'react';
import { App as AntdApp, ConfigProvider, theme as antdAlgorithm } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
// antd 主题由设计系统下发，这里**不写死任何色值**。
// （控制台此前硬编码过 5 个色值 + borderRadius:6，那是 KI-011：令牌变更传导不到，各控制台各自漂移。）
import antdTheme from '@autional-cn/tokens/antd-theme';
import { useTheme } from '../context/ThemeProvider';

export interface AntdThemeProviderProps {
	children: React.ReactNode;
	/** 覆盖 locale 判定。默认按 i18n.language 是否以 zh 开头。 */
	locale?: 'zh-CN' | 'en-US';
}

/**
 * 把 antd 接到设计系统上：同一个令牌源、同一个暗色开关、同一个语言。
 * 必须挂在 `<ThemeProvider>` 之内（它依赖 `useTheme()`）。
 */
export function AntdThemeProvider({ children, locale }: AntdThemeProviderProps) {
	const { theme } = useTheme();
	const { i18n } = useTranslation();

	const resolved = useMemo(() => {
		if (locale) return locale;
		return String(i18n.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
	}, [locale, i18n.language]);

	const isDark = theme === 'dark';

	return (
		<ConfigProvider
			locale={resolved === 'zh-CN' ? zhCN : enUS}
			theme={{
				algorithm: isDark ? antdAlgorithm.darkAlgorithm : antdAlgorithm.defaultAlgorithm,
				token: (isDark ? antdTheme.dark : antdTheme.light).token,
				// 组件级 token 由桥下发（不是在这里手写）。它统一的是「视觉维度」——
				// 表头底色 / 悬浮态 / 边框 / 行高 —— 而且**对所有 antd Table 生效**，
				// 包括控制台现存的那些直接使用，它们一行都不用改。
				components: (isDark ? antdTheme.dark : antdTheme.light).components,
			}}
		>
			<AntdApp>{children}</AntdApp>
		</ConfigProvider>
	);
}

/**
 * 取 antd 的命令式 API（message / modal / notification）。
 *
 * 刻意**不**做模块级可变单例（那是三个控制台现在各自的做法：
 * `export let message` + 在 useEffect 里赋值）。单例在 SSR、多实例、测试隔离三处都会咬人；
 * 用 hook 拿，作用域天然正确。
 */
export function useAntdApp() {
	return AntdApp.useApp();
}

/** `App.useApp()` 的返回类型（message / notification / modal 三个命令式 API）。 */
export type AntdAppApi = ReturnType<typeof AntdApp.useApp>;
