import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Modal as AntModal } from 'antd';
import { Modal } from '../Modal';

// antd 的 Modal 走 portal，渲染在 document.body 上 —— 一律从 body 查（与 Drawer 测试同）。
//
// 本文件锁的是一条**覆写链**：rc-dialog 把关闭按钮的 aria-label 写死为 "Close"，
// 但把 closable 对象里的 aria-* 属性展开在其**之后** —— 桥注入的标签靠这条才能到按钮上。
// 所以必须有阴性对照（同语言下的裸 antd Modal）：只测阳性，一个被 rc-dialog 忽略的键
// 也会让断言「通过」，因为期望值和测量对象就成了同一个东西。

async function makeI18n(lng = 'zh-CN'): Promise<I18nInstance> {
	const instance = createInstance();
	await instance.init({
		resources: { 'zh-CN': { translation: {} }, 'en-US': { translation: {} } },
		lng,
		fallbackLng: 'zh-CN',
		keySeparator: false,
	});
	return instance;
}

async function renderWith(ui: React.ReactElement, lng = 'zh-CN') {
	const instance = await makeI18n(lng);
	return render(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>);
}

const closeBtn = () => document.body.querySelector('.ant-modal-close') as HTMLElement | null;

describe('Modal（关闭按钮 aria 契约，PL-11/32/40）', () => {
	it('阴性对照：裸 antd Modal 在中文站点下关闭按钮 aria-label 仍是英文 Close（问题本体）', async () => {
		await renderWith(<AntModal open title="新建" />);
		expect(closeBtn()?.getAttribute('aria-label')).toBe('Close');
	});

	it('桥注入本地化标签：zh 站点关闭按钮 aria-label = 关闭', async () => {
		await renderWith(<Modal open title="新建" />);
		expect(closeBtn()?.getAttribute('aria-label')).toBe('关闭');
	});

	it('en 站点跟随语言（标签来自语言解析链，不是写死）', async () => {
		await renderWith(<Modal open title="Create" />, 'en-US');
		expect(closeBtn()?.getAttribute('aria-label')).toBe('Close');
	});

	it('closable={false} 保持 false：不渲染关闭按钮', async () => {
		await renderWith(<Modal open title="新建" closable={false} />);
		expect(closeBtn()).toBeNull();
	});

	it('用户在 closable 里显式传的 aria-label 优先于桥默认', async () => {
		await renderWith(<Modal open title="新建" closable={{ 'aria-label': '关闭新建对话框' }} />);
		expect(closeBtn()?.getAttribute('aria-label')).toBe('关闭新建对话框');
	});

	it('关闭链路仍是 antd 的：点击 X 触发 onCancel（桥没有重造按钮）', async () => {
		const onCancel = vi.fn();
		await renderWith(<Modal open title="新建" onCancel={onCancel} />);
		closeBtn()?.click();
		expect(onCancel).toHaveBeenCalled();
	});

	it('透传：title / footer / 正文', async () => {
		await renderWith(
			<Modal open title="新建租户" footer={<button type="button">保存</button>}>
				<p>正文</p>
			</Modal>,
		);
		expect(screen.getByText('新建租户')).toBeTruthy();
		expect(screen.getByText('保存')).toBeTruthy();
		expect(screen.getByText('正文')).toBeTruthy();
	});
});
