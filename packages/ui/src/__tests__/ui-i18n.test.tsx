import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { PortalSwitcher } from '../molecules/PortalSwitcher';
import { UI_I18N_NS, registerUiI18n } from '../i18n';

// 模拟消费站真实形态：单 ns 'translation'、扁平点键（keySeparator: false）
async function makeSiteI18n(
	lng: string,
	{ shape = 'admin', register = true }: { shape?: 'admin' | 'platform'; register?: boolean } = {},
): Promise<I18nInstance> {
	const instance = createInstance();
	await instance.init({
		resources: { 'zh-CN': { translation: {} }, 'en-US': { translation: {} } },
		lng,
		fallbackLng: 'zh-CN',
		keySeparator: false,
		interpolation: { escapeValue: false },
		...(shape === 'admin' ? { supportedLngs: ['zh-CN', 'en-US'] } : {}),
	});
	if (register) registerUiI18n(instance);
	return instance;
}

const PORTALS = [
	{ code: 'admin', name: 'Administration', url: 'https://admin.example.com/' },
	{ code: 'partner', name: 'Partner Portal', url: 'https://partner.example.com/' },
];

async function openSwitcher(instance: I18nInstance) {
	const user = userEvent.setup();
	render(
		<I18nextProvider i18n={instance}>
			<PortalSwitcher portals={PORTALS} />
		</I18nextProvider>,
	);
	await user.click(screen.getByRole('button'));
}

describe('PortalSwitcher × 站点 i18next（资源包路线）', () => {
	it('未注册：按站点语言回落内置文案（defaultValue 路径）', async () => {
		const instance = await makeSiteI18n('zh-CN', { register: false });
		expect(instance.hasResourceBundle('zh-CN', UI_I18N_NS)).toBe(false);
		await openSwitcher(instance);
		expect(screen.getByRole('menuitem', { name: /管理后台/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '切换门户' })).toBeInTheDocument();
	});

	it('已注册：经站点 i18next 解析（中文）', async () => {
		const instance = await makeSiteI18n('zh-CN');
		expect(instance.hasResourceBundle('zh-CN', UI_I18N_NS)).toBe(true);
		await openSwitcher(instance);
		expect(screen.getByRole('menuitem', { name: /管理后台/ })).toBeInTheDocument();
		expect(instance.t('portal.names.admin', { ns: UI_I18N_NS })).toBe('管理后台');
	});

	it('已注册：英文站点解析英文文案', async () => {
		const instance = await makeSiteI18n('en-US');
		await openSwitcher(instance);
		expect(screen.getByRole('menuitem', { name: /Admin Console/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Switch portal' })).toBeInTheDocument();
	});

	it('platform 形态：裸码 en 别名同样解析', async () => {
		const instance = await makeSiteI18n('en', { shape: 'platform' });
		await openSwitcher(instance);
		expect(screen.getByRole('menuitem', { name: /Admin Console/ })).toBeInTheDocument();
	});

	it('站点先注册的覆盖值胜出（registerUiI18n 不覆盖既有）', async () => {
		const instance = await makeSiteI18n('zh-CN', { register: false });
		instance.addResourceBundle('zh-CN', UI_I18N_NS, { 'portal.names.admin': '我的后台' }, true, false);
		registerUiI18n(instance);
		await openSwitcher(instance);
		expect(screen.getByRole('menuitem', { name: /我的后台/ })).toBeInTheDocument();
	});

	it('站点注册后覆盖（overwrite）同样胜出', async () => {
		const instance = await makeSiteI18n('zh-CN');
		instance.addResourceBundle('zh-CN', UI_I18N_NS, { 'portal.names.admin': '站点叫法' }, true, true);
		await openSwitcher(instance);
		expect(screen.getByRole('menuitem', { name: /站点叫法/ })).toBeInTheDocument();
	});

	it('已注册但未收录 code：回落传入 name（不落到 key 文本）', async () => {
		const instance = await makeSiteI18n('zh-CN');
		await openSwitcher(instance);
		expect(screen.getByRole('menuitem', { name: /Partner Portal/ })).toBeInTheDocument();
	});
});
