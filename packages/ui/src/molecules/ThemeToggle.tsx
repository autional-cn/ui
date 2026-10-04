import { Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeProvider';
import { UI_I18N_NS, uiText } from '../i18n';

interface ThemeToggleProps {
	className?: string;
	iconSize?: number;
	labelLight?: string;
	labelDark?: string;
}

export function ThemeToggle({
	className = '',
	iconSize = 18,
	labelLight,
	labelDark,
}: ThemeToggleProps) {
	const { theme, toggle } = useTheme();
	const { t, i18n } = useTranslation();
	const isDark = theme === 'dark';
	// 文案解析链与 PortalSwitcher 同构：站点 i18next（注册 registerUiI18n 后可覆盖）→ 内置表（未注册）
	// → 组件参数。原实现为硬编码中文默认值，EN 站点顶栏出现中文标签（UP-04）。
	const text = (key: string): string => {
		const builtin = uiText(i18n.language, key);
		return t(key, { ns: UI_I18N_NS, defaultValue: builtin ?? key });
	};
	const label = isDark
		? labelLight || text('theme.toggleLight')
		: labelDark || text('theme.toggleDark');

	return (
		<button
			onClick={toggle}
			className={`rounded-md transition-colors ${className}`}
			title={label}
			aria-label={label}
		>
			{isDark ? <Sun size={iconSize} /> : <Moon size={iconSize} />}
		</button>
	);
}
