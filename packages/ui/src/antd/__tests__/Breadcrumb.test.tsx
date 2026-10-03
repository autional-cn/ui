// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Breadcrumb, buildBreadcrumbTrail, stripTenantSegment } from '../Breadcrumb';

// 这个件是从**三份不同实现**里收出来的（admin 145 / platform 54 / user 77 行），
// 所以测试盯的是「三份里那些**行为差异**最后统一成了什么」，而不只是「能渲染」。
const labels = { '/wallet': '钱包', '/wallet/withdrawals': '提现记录' };

describe('stripTenantSegment', () => {
	it('剥掉租户首段；等于租户段时归为根；不是租户段则不动', () => {
		expect(stripTenantSegment('/acme/users', 'acme')).toBe('/users');
		expect(stripTenantSegment('/acme', 'acme')).toBe('/');
		expect(stripTenantSegment('/users', 'acme')).toBe('/users');
		expect(stripTenantSegment('/acme/users', null)).toBe('/acme/users');
	});
});

describe('buildBreadcrumbTrail', () => {
	it('按段累积：命中的中间段可点、末段不可点', () => {
		const trail = buildBreadcrumbTrail({ path: '/wallet/withdrawals', labels, home: { label: '概览', href: '/acme' } });
		expect(trail).toEqual([
			{ label: '概览', href: '/acme' },
			{ label: '钱包', href: '/wallet' },
			{ label: '提现记录', href: undefined },
		]);
	});

	it('未命中的段不静默丢掉：有 detailLabel 且像 ID 时显示它，否则原样显示', () => {
		const withDetail = buildBreadcrumbTrail({ path: '/wallet/01KSQCBNVMS6SX64PJS937CE33', labels, detailLabel: '详情' });
		expect(withDetail.map((t) => t.label)).toEqual(['钱包', '详情']);
		const plain = buildBreadcrumbTrail({ path: '/wallet/unknown-page', labels });
		expect(plain.map((t) => t.label)).toEqual(['钱包', 'unknown-page']);
	});

	it('带尾斜杠的 URL 也能匹配（真实路由里 /acme/wallet/ 很常见）', () => {
		const trail = buildBreadcrumbTrail({ path: stripTenantSegment('/acme/wallet/withdrawals/', 'acme'), labels });
		expect(trail.map((t) => t.label)).toEqual(['钱包', '提现记录']);
	});

	it('buildHref 决定中间段的链接形态（各站带租户前缀的方式不同）', () => {
		const trail = buildBreadcrumbTrail({ path: '/wallet/withdrawals', labels, buildHref: (p) => '/acme' + p });
		expect(trail[0].href).toBe('/acme/wallet');
	});
});

describe('Breadcrumb 组件', () => {
	it('根路径不渲染（原本三份都有这条规则）', () => {
		const { container } = render(
			<MemoryRouter>
				<Breadcrumb pathname="/acme" tenantSlug="acme" labels={labels} />
			</MemoryRouter>,
		);
		expect(container.querySelector('.ant-breadcrumb')).toBeNull();
	});

	it('只有一项时不渲染', () => {
		const { container } = render(
			<MemoryRouter>
				<Breadcrumb pathname="/acme/unknown-page" tenantSlug="acme" labels={{}} />
			</MemoryRouter>,
		);
		expect(container.querySelector('.ant-breadcrumb')).toBeNull();
	});

	it('渲染出各级文案，中间段是可点链接', () => {
		render(
			<MemoryRouter>
				<Breadcrumb
					pathname="/acme/wallet/withdrawals"
					tenantSlug="acme"
					labels={labels}
					home={{ label: '概览', href: '/acme' }}
				/>
			</MemoryRouter>,
		);
		expect(screen.getByText('钱包')).toBeTruthy();
		expect(screen.getByText('提现记录')).toBeTruthy();
		expect(screen.getByText('钱包').closest('a')?.getAttribute('href')).toBe('/wallet');
		expect(screen.getByText('提现记录').closest('a')).toBeNull();
	});
});
