import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Modal } from '../Modal';

// UP-19 回归锁：弹窗此前是裸 div 覆盖层 —— 无 role="dialog"/aria-modal、无焦点管理
// （打开后焦点仍留在背后页面、Tab 能溜出去、关闭后焦点丢 body）。本文件锁住三件事：
// ① 对话框语义与可访问名；② 打开时焦点移入 + 关闭时归还触发元素；③ Tab 在弹窗内圈定。

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

async function renderModal(ui: React.ReactElement, lng = 'zh-CN') {
	const instance = await makeI18n(lng);
	return render(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>);
}

describe('Modal — 无障碍语义（UP-19）', () => {
	it('role=dialog + aria-modal；可访问名取标题、说明取 aria-describedby', async () => {
		await renderModal(
			<Modal open onClose={() => {}} title="删除确认" description="此操作不可撤销">
				<p>正文</p>
			</Modal>,
		);
		const dialog = screen.getByRole('dialog', {
			name: '删除确认',
			description: '此操作不可撤销',
		});
		expect(dialog).toHaveAttribute('aria-modal', 'true');
	});

	it('无标题的弹窗仍是 dialog；关闭按钮有无障碍标签', async () => {
		await renderModal(
			<Modal open onClose={() => {}}>
				<p>只有正文</p>
			</Modal>,
		);
		const dialog = screen.getByRole('dialog');
		expect(dialog).not.toHaveAttribute('aria-labelledby');
		expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
	});
});

describe('Modal — 焦点管理（UP-19）', () => {
	it('打开时焦点移入弹窗（首个可聚焦元素），关闭后归还触发按钮', async () => {
		const user = userEvent.setup();
		function Harness() {
			const [open, setOpen] = React.useState(false);
			return (
				<>
					<button onClick={() => setOpen(true)}>打开弹窗</button>
					<Modal open={open} onClose={() => setOpen(false)} title="删除确认">
						<button>确认删除</button>
					</Modal>
				</>
			);
		}
		await renderModal(<Harness />);

		const trigger = screen.getByRole('button', { name: '打开弹窗' });
		await user.click(trigger);

		// 移入：带标题时首个可聚焦元素 = 头部关闭按钮（而非留在背后的触发按钮）。
		expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();

		await user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it('无标题弹窗：焦点移入弹窗内的关闭按钮（不留在背后页面）', async () => {
		await renderModal(
			<Modal open onClose={() => {}}>
				<p>纯文本</p>
			</Modal>,
		);
		const dialog = screen.getByRole('dialog');
		expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
		expect(dialog.contains(document.activeElement)).toBe(true);
	});

	it('消费方标了 autoFocus 时，焦点落到那个元素（表单弹窗直进输入框，不被首个可聚焦元素抢走）', async () => {
		await renderModal(
			<Modal open onClose={() => {}} title="删除确认">
				<input aria-label="确认口令" autoFocus />
			</Modal>,
		);
		expect(screen.getByLabelText('确认口令')).toHaveFocus();
	});

	it('Tab 在弹窗内圈定：末元素 Tab 回首个、首元素 Shift+Tab 回末个', async () => {
		const user = userEvent.setup();
		await renderModal(
			<Modal open onClose={() => {}} title="删除确认">
				<button>确认删除</button>
			</Modal>,
		);
		const closeBtn = screen.getByRole('button', { name: '关闭' });
		const confirmBtn = screen.getByRole('button', { name: '确认删除' });

		expect(closeBtn).toHaveFocus();
		await user.tab();
		expect(confirmBtn).toHaveFocus();
		// 末元素再 Tab：圈回首个（旧实现此处焦点会溜到 document.body/背后页面）。
		await user.tab();
		expect(closeBtn).toHaveFocus();
		// 首个 Shift+Tab：圈回末个。
		await user.tab({ shift: true });
		expect(confirmBtn).toHaveFocus();
	});
});
