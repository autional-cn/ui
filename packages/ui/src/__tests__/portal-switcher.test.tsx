import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortalSwitcher } from '../molecules/PortalSwitcher';

const i18nState = vi.hoisted(() => ({ language: 'zh-CN' }));
vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		i18n: i18nState,
		t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
	}),
}));

// name 模拟目录 API 返回的英文名：已知 code 应被内置本地化名覆盖
const PORTALS = [
	{ code: 'admin', name: 'Administration', url: 'https://admin.autional.cn/acme-corp/' },
	{ code: 'user', name: 'End-User Portal', url: 'https://user.autional.cn/acme-corp/' },
];

const trigger = () => screen.getByRole('button', { name: '切换门户' });

describe('PortalSwitcher', () => {
	beforeEach(() => {
		i18nState.language = 'zh-CN';
	});

	it('点击展开门户列表（已知 code 本地化名优先于服务端名）', async () => {
		const user = userEvent.setup();
		render(<PortalSwitcher portals={PORTALS} currentPortal="admin" />);
		expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
		await user.click(trigger());
		expect(screen.getByRole('menuitem', { name: /用户中心/ })).toBeInTheDocument();
		expect(screen.getByRole('menuitem', { name: /管理后台/ })).toBeInTheDocument();
	});

	const BARE = [
		{ code: 'admin', url: 'https://admin.autional.cn/acme-corp/' },
		{ code: 'security', url: 'https://security.autional.cn/acme-corp/' },
	];

	it('条目无 name 时按 code 回落内置中文名', async () => {
		const user = userEvent.setup();
		render(<PortalSwitcher portals={BARE} />);
		await user.click(trigger());
		expect(screen.getByRole('menuitem', { name: /管理后台/ })).toBeInTheDocument();
		expect(screen.getByRole('menuitem', { name: /安全中心/ })).toBeInTheDocument();
	});

	it('内置名跟随英文界面（含服务端名条目）', async () => {
		i18nState.language = 'en-US';
		const user = userEvent.setup();
		render(<PortalSwitcher portals={PORTALS} />);
		await user.click(screen.getByRole('button', { name: 'Switch portal' }));
		expect(screen.getByRole('menuitem', { name: /Admin Console/ })).toBeInTheDocument();
		expect(screen.getByRole('menuitem', { name: /End-User Portal/ })).toBeInTheDocument();
	});

	it('未收录 code 回落服务端名，再回落 code', async () => {
		const user = userEvent.setup();
		render(
			<PortalSwitcher
				portals={[
					{ code: 'partner', name: 'Partner Portal', url: 'https://partner.example.com/' },
					{ code: 'mystery', url: 'https://mystery.example.com/' },
				]}
			/>,
		);
		await user.click(trigger());
		expect(screen.getByRole('menuitem', { name: /Partner Portal/ })).toBeInTheDocument();
		expect(screen.getByRole('menuitem', { name: /mystery/ })).toBeInTheDocument();
	});

	it('单门户默认隐藏（渲染 null），hideWhenSingle=false 可显示', () => {
		const { container } = render(
			<PortalSwitcher portals={[PORTALS[0]!]} hideWhenSingle />,
		);
		expect(container.firstChild).toBeNull();

		render(<PortalSwitcher portals={[PORTALS[0]!]} hideWhenSingle={false} />);
		expect(trigger()).toBeInTheDocument();
	});

	it('loading：单门户也保留占位触发钮（禁用态）', () => {
		render(<PortalSwitcher portals={[PORTALS[0]!]} loading />);
		expect(trigger()).toBeDisabled();
		expect(trigger()).toHaveAttribute('aria-busy', 'true');
	});

	it('当前门户带 aria-current 标记，点击只关闭不跳转', async () => {
		const user = userEvent.setup();
		render(<PortalSwitcher portals={PORTALS} currentPortal="admin" />);
		await user.click(trigger());
		const current = screen.getByRole('menuitem', { name: /管理后台/ });
		expect(current).toHaveAttribute('aria-current', 'true');
		await user.click(current);
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('非当前门户为完整锚点（href 指向目标门户）', async () => {
		const user = userEvent.setup();
		render(<PortalSwitcher portals={PORTALS} currentPortal="admin" />);
		await user.click(trigger());
		const other = screen.getByRole('menuitem', { name: /用户中心/ });
		expect(other).toHaveAttribute('href', 'https://user.autional.cn/acme-corp/');
		expect(other).not.toHaveAttribute('aria-current');
	});

	it('labels 覆盖切换按钮 aria-label', () => {
		render(<PortalSwitcher portals={PORTALS} labels={{ switchPortal: '切换产品' }} />);
		expect(screen.getByRole('button', { name: '切换产品' })).toBeInTheDocument();
	});
});
