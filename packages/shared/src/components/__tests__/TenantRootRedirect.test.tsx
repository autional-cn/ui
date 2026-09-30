// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ============================================================
// F-W7-a：TenantRootRedirect 的裸根 slug 解析
//  - slug 解析**唯一权威 = 公开租户名单**（id → name，name 即 slug）
//  - 会话 store 的 tenants[].name 是**展示名**（"Demo Tenant"），拼进 URL 会落
//    /Demo%20Tenant/ → 404（回归修复；与 auth 站 8859e4d pickSessionSlug 同口径）
//  - 有会话但公开名单未返回：等待，不抢跑漏斗 brand
// ============================================================

const { mockState } = vi.hoisted(() => ({
	mockState: {
		currentTenantId: null as string | null,
		// 会话 store 的租户（展示名口径）——回归锁：组件若回退用它，断言必红
		storeTenants: [] as Array<{ id: string; name: string; role: string }>,
		replace: vi.fn(),
	},
}));

vi.mock('../../hooks/useAuth', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../hooks/useAuth')>()),
	useCurrentTenantId: () => mockState.currentTenantId,
	useTenants: () => mockState.storeTenants,
}));

import { TenantRootRedirect } from '../TenantRootRedirect';
import { getPortalUrl } from '../../config';

function wrapper(children: ReactNode) {
	return (
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}
		>
			{children}
		</QueryClientProvider>
	);
}

function stubTenantList(items: unknown[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ code: 0, message: 'success', items, total: items.length }),
		}),
	);
}

function expectedBrandFunnel() {
	return `${getPortalUrl('brand')}/?redirect=${encodeURIComponent(
		window.location.origin + window.location.pathname,
	)}`;
}

/** 剥除 authTrace 面包屑（rt=）后比较；rt 装饰本身由专门断言锁定。 */
function withoutRt(url: string): string {
	const u = new URL(url, 'http://trace.invalid');
	u.searchParams.delete('rt');
	return u.pathname + u.search;
}

const originalWindowLocation = window.location;

beforeEach(() => {
	vi.clearAllMocks();
	mockState.currentTenantId = null;
	mockState.storeTenants = [];
	window.history.pushState({}, '', '/');
	delete (window as any).__APP_CONFIG__;

	// replace 拦截 + 关键读取面委托真身（pushState 后仍反映当前值）
	delete (window as any).location;
	(window as any).location = Object.defineProperties(
		{},
		{
			...Object.getOwnPropertyDescriptors(originalWindowLocation),
			protocol: { get: () => originalWindowLocation.protocol, configurable: true },
			hostname: { get: () => originalWindowLocation.hostname, configurable: true },
			origin: { get: () => originalWindowLocation.origin, configurable: true },
			href: { get: () => originalWindowLocation.href, configurable: true },
			pathname: { get: () => originalWindowLocation.pathname, configurable: true },
			replace: { get: () => mockState.replace, configurable: true },
		},
	);
});

afterEach(() => {
	if (window.location !== originalWindowLocation) {
		Object.defineProperty(window, 'location', { value: originalWindowLocation, writable: true });
	}
	cleanup();
	vi.unstubAllGlobals();
});

describe('TenantRootRedirect 裸根漏斗', () => {
	it('有会话 + 名单命中 → 跳 /<slug>/，且 slug 取自公开名单（非展示名）', async () => {
		mockState.currentTenantId = 't1';
		// 会话 store 里是展示名（老缺陷来源）——组件不得使用
		mockState.storeTenants = [{ id: 't1', name: 'Demo Tenant', role: 'owner' }];
		stubTenantList([{ id: 't1', name: 'demo', display_name: 'Demo Tenant' }]);

		render(wrapper(<TenantRootRedirect />));

		await waitFor(() => expect(mockState.replace).toHaveBeenCalled());
		const url = String(mockState.replace.mock.calls[0][0]);
		expect(url).toContain('rt=localhost.funnel-slug.');
		expect(withoutRt(url)).toBe('/demo/');
		expect(url).not.toContain('Demo%20Tenant');
		expect(url).not.toContain('Demo');
	});

	it('名单项只有 slug 字段（无 name）→ 回退 slug', async () => {
		mockState.currentTenantId = 't1';
		stubTenantList([{ id: 't1', slug: 'demo-fallback' }]);

		render(wrapper(<TenantRootRedirect />));

		await waitFor(() => expect(mockState.replace).toHaveBeenCalled());
		expect(withoutRt(String(mockState.replace.mock.calls[0][0]))).toBe('/demo-fallback/');
	});

	it('有会话但名单未返回（加载中）→ 等待，不抢跑 brand 漏斗', async () => {
		mockState.currentTenantId = 't1';
		vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

		render(wrapper(<TenantRootRedirect />));

		await new Promise((r) => setTimeout(r, 60));
		expect(mockState.replace).not.toHaveBeenCalled();
	});

	it('无会话 → 漏斗 brand（带 redirect=当前 origin+pathname）', async () => {
		stubTenantList([{ id: 't1', name: 'demo' }]);

		render(wrapper(<TenantRootRedirect />));

		await waitFor(() => expect(mockState.replace).toHaveBeenCalled());
		expect(withoutRt(String(mockState.replace.mock.calls[0][0]))).toBe(withoutRt(expectedBrandFunnel()));
	});

	it('有会话但名单无匹配（陈旧会话）→ 漏斗 brand', async () => {
		mockState.currentTenantId = 't-unknown';
		stubTenantList([{ id: 't1', name: 'demo' }]);

		render(wrapper(<TenantRootRedirect />));

		await waitFor(() => expect(mockState.replace).toHaveBeenCalled());
		expect(withoutRt(String(mockState.replace.mock.calls[0][0]))).toBe(withoutRt(expectedBrandFunnel()));
	});

	it('名单接口失败（返回空数组）→ 有会话按无匹配处理，漏斗 brand（不卡死）', async () => {
		mockState.currentTenantId = 't1';
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

		render(wrapper(<TenantRootRedirect />));

		await waitFor(() => expect(mockState.replace).toHaveBeenCalled());
		expect(withoutRt(String(mockState.replace.mock.calls[0][0]))).toBe(withoutRt(expectedBrandFunnel()));
	});
});
