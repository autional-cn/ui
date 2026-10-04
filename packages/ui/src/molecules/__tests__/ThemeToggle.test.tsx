import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ThemeToggle } from '../ThemeToggle';
import { ThemeProvider } from '../../context/ThemeProvider';
import { registerUiI18n } from '../../i18n';

// UP-04 回归锁：默认文案此前是组件内硬编码中文 —— EN 站点顶栏出现「切换到深色模式」。
// 修复后走与 PortalSwitcher 同构的解析链：站点 i18next（可覆盖）→ 内置表（未注册）→ 组件参数。

async function makeSiteI18n(lng: string, register = true): Promise<I18nInstance> {
	const instance = createInstance();
	await instance.init({
		resources: { 'zh-CN': { translation: {} }, 'en-US': { translation: {} } },
		lng,
		fallbackLng: 'zh-CN',
		keySeparator: false,
		interpolation: { escapeValue: false },
	});
	if (register) registerUiI18n(instance);
	return instance;
}

function renderToggle(instance: I18nInstance, props: Record<string, unknown> = {}) {
	return render(
		<I18nextProvider i18n={instance}>
			<ThemeProvider defaultTheme="light">
				<ThemeToggle {...props} />
			</ThemeProvider>
		</I18nextProvider>,
	);
}

describe('ThemeToggle × 站点 i18next（UP-04）', () => {
	beforeEach(() => {
		// ThemeProvider 读 localStorage 的持久化档位；清掉避免用例间互相串档。
		localStorage.clear();
	});

	it('EN 站点：标签为英文（此前硬编码中文）', async () => {
		renderToggle(await makeSiteI18n('en-US'));
		expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
	});

	it('ZH 站点：标签为中文', async () => {
		renderToggle(await makeSiteI18n('zh-CN'));
		expect(screen.getByRole('button', { name: '切换到深色模式' })).toBeInTheDocument();
	});

	it('未注册站点按站点语言回落内置表', async () => {
		renderToggle(await makeSiteI18n('en-US', false));
		expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
	});

	it('站点覆盖胜出（注册后可改文案）', async () => {
		const instance = await makeSiteI18n('zh-CN');
		instance.addResourceBundle('zh-CN', 'autional-ui', { 'theme.toggleDark': '夜间模式' }, true, true);
		renderToggle(instance);
		expect(screen.getByRole('button', { name: '夜间模式' })).toBeInTheDocument();
	});

	it('labelDark 参数优先级最高（既有调用方行为不变）', async () => {
		renderToggle(await makeSiteI18n('en-US'), { labelDark: '自定义标签' });
		expect(screen.getByRole('button', { name: '自定义标签' })).toBeInTheDocument();
	});

	it('点击翻转后切到「浅色」方向标签', async () => {
		renderToggle(await makeSiteI18n('en-US'));
		await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to dark mode' }));
		expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
	});
});
