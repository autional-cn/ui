import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
	theme: Theme;
	toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
	theme: 'light',
	toggle: () => {},
});

interface ThemeProviderProps {
	children: React.ReactNode;
	storageKey?: string;
	/**
	 * 深色档写入 data-theme 的值（默认 'dark'）。
	 * 站点若使用完整深色变体（如 authenticator 的 [data-theme="authenticator"]），
	 * 在这里传变体名；其余站点不传，行为不变。
	 */
	darkThemeName?: string;
	/**
	 * 无存储值（首次访问）时的兜底档；缺省沿用 prefers-color-scheme → light 的既有行为。
	 * dark-first 的站点传 'dark'（与站点 boot script 的兜底保持一致）。
	 */
	defaultTheme?: Theme;
}

export function ThemeProvider({
	children,
	storageKey = 'autional-theme',
	darkThemeName = 'dark',
	defaultTheme,
}: ThemeProviderProps) {
	const [theme, setTheme] = useState<Theme>(() => {
		if (typeof window !== 'undefined') {
			try {
				const saved = localStorage.getItem(storageKey) as Theme;
				if (saved === 'dark' || saved === 'light') return saved;
			} catch (e) {
				// 存储不可用（隐私模式/被禁用）：与站点 boot script 的兜底口径一致，继续走默认链
			}
			if (defaultTheme) return defaultTheme;
			if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
		}
		return 'light';
	});

	useEffect(() => {
		const root = document.documentElement;
		if (theme === 'dark') {
			root.classList.add('dark');
		} else {
			root.classList.remove('dark');
		}
		root.setAttribute('data-theme', theme === 'dark' ? darkThemeName : 'light');
	}, [theme, darkThemeName]);

	const toggle = useCallback(() => {
		setTheme((prev) => {
			const next = prev === 'dark' ? 'light' : 'dark';
			try {
				localStorage.setItem(storageKey, next);
			} catch (e) {
				// 存储不可用（隐私模式/被禁用）：本次切换仍生效，仅不持久化
			}
			return next;
		});
	}, [storageKey]);

	return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	return useContext(ThemeContext);
}
