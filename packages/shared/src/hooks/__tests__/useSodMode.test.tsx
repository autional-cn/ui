// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ============================================================
// U97 回归锁 — useSodMode 四连缺陷修复:
//   ① URL 含 /tenant 服务段（不再是 /api/v1/... 裸径 → 网关 404）
//   ② 请求参数为租户 ULID（不再是 slug → 后端按主键 id 查找必 404）
//   ③ 失败不再静默吞成 'single'（返回 null；错误留在 react-query 通道）
//   ④ 读取键为 camelCase `sodMode`（响应拦截器 camelCaseKeys 契约；
//      读 snake_case `sod_mode` 恒 undefined —— 请求虽 200 但值被吞）
// ============================================================

vi.mock('../../api/client', () => ({
	apiClient: { get: vi.fn() },
}));

import { apiClient } from '../../api/client';
import { useAuthStore } from '../../auth/store';
import { useSodMode, useIsAuditRestricted } from '../useSodMode';

const mockedGet = vi.mocked(apiClient.get);

/** 租户 ULID（后端 GetSodConfig 按主键查找的键） */
const TENANT_ULID = '01M24BB8G083JHWKTXXVGWMWQA';
/** slug 字样：URL 中不得出现（缺陷② 的负例锚点） */
const SLUG = 'demo';
const TENANTS = [{ id: TENANT_ULID, name: SLUG, role: 'admin' }];

/** 模拟 axios 响应拦截器（api/client.ts camelCaseKeys）之后的形状 */
function sodResponse(sodMode: 'single' | 'strict') {
	return {
		data: {
			tenantId: TENANT_ULID,
			sodMode,
			updatedAt: '2026-09-30T00:00:00Z',
		},
	} as never;
}

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, retryDelay: 10 } },
	});
	return {
		queryClient,
		wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		},
	};
}

/** 重置 store + localStorage，避免跨用例污染 */
function resetAuthStore(): void {
	useAuthStore.setState({
		user: null,
		accessToken: null,
		refreshToken: null,
		tenants: [],
		currentTenantId: null,
		permissions: [],
		isAuthenticated: false,
	});
	window.localStorage.clear();
}

describe('useSodMode（U97 回归锁：路径服务段 / ULID 参数 / 失败不吞 / camelCase 键）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAuthStore();
	});

	afterEach(() => {
		cleanup();
		resetAuthStore();
	});

	it('①+②+④ 成功: URL = /tenant/api/v1/admin/tenants/<ULID>/sod-config 且读到 sodMode=strict', async () => {
		useAuthStore.setState({ tenants: TENANTS, currentTenantId: TENANT_ULID, accessToken: 't' });
		mockedGet.mockResolvedValue(sodResponse('strict'));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSodMode(), { wrapper });

		await waitFor(() => expect(result.current).toBe('strict'));

		// ① 服务段：完整路径精确断言（旧实现 /api/v1/... 裸径将 FAIL）
		expect(mockedGet).toHaveBeenCalledWith(
			`/tenant/api/v1/admin/tenants/${TENANT_ULID}/sod-config`,
		);
		const calledUrl = mockedGet.mock.calls[0][0] as string;
		expect(calledUrl).not.toMatch(/^\/api\/v1\//);
		// ② 参数是 ULID，不是 slug
		expect(calledUrl).toContain(TENANT_ULID);
		expect(calledUrl).not.toContain(`/${SLUG}/`);
	});

	it('④ 服务端返回 single → single（正常值不丢）', async () => {
		useAuthStore.setState({ tenants: TENANTS, currentTenantId: TENANT_ULID, accessToken: 't' });
		mockedGet.mockResolvedValue(sodResponse('single'));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSodMode(), { wrapper });

		await waitFor(() => expect(result.current).toBe('single'));
	});

	it('② 无租户（currentTenantId=null）→ 不发请求，返回 null', () => {
		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSodMode(), { wrapper });

		expect(result.current).toBeNull();
		expect(mockedGet).not.toHaveBeenCalled();
	});

	it('③ 请求失败 → null（不吞成 single），且错误进入 query error 态（不再静默）', async () => {
		useAuthStore.setState({ tenants: TENANTS, currentTenantId: TENANT_ULID, accessToken: 't' });
		mockedGet.mockRejectedValue(new Error('Network Error'));

		const { queryClient, wrapper } = createWrapper();
		const { result } = renderHook(() => useSodMode(), { wrapper });

		// retry:1（hook 显式）→ 失败重试一次后进入 error 态
		await waitFor(
			() => {
				expect(queryClient.getQueryState(['sod-config', TENANT_ULID])?.status).toBe('error');
			},
			{ timeout: 5000 },
		);
		// 关键回归锁：绝不是 'single'（旧实现 catch 吞错 + `?? 'single'` 恒 single）
		expect(result.current).toBeNull();
		expect(result.current).not.toBe('single');
	});
});

describe('useIsAuditRestricted（U97 消费面语义）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAuthStore();
	});

	afterEach(() => {
		cleanup();
		resetAuthStore();
	});

	it('strict ∧ role=admin → true（strict 模式 L2 限制生效）', async () => {
		useAuthStore.setState({ tenants: TENANTS, currentTenantId: TENANT_ULID, accessToken: 't' });
		mockedGet.mockResolvedValue(sodResponse('strict'));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useIsAuditRestricted(), { wrapper });

		await waitFor(() => expect(result.current).toBe(true));
	});

	it('strict ∧ 非 admin → false', async () => {
		useAuthStore.setState({
			tenants: [{ id: TENANT_ULID, name: SLUG, role: 'member' }],
			currentTenantId: TENANT_ULID,
			accessToken: 't',
		});
		mockedGet.mockResolvedValue(sodResponse('strict'));

		const { queryClient, wrapper } = createWrapper();
		const { result } = renderHook(() => useIsAuditRestricted(), { wrapper });

		// 等 sod 数据确实到达（success）后再断言 —— 避免「数据未到即 false」的假绿
		await waitFor(() => {
			expect(queryClient.getQueryState(['sod-config', TENANT_ULID])?.status).toBe('success');
		});
		expect(result.current).toBe(false);
	});

	it('single（admin）→ false', async () => {
		useAuthStore.setState({ tenants: TENANTS, currentTenantId: TENANT_ULID, accessToken: 't' });
		mockedGet.mockResolvedValue(sodResponse('single'));

		const { queryClient, wrapper } = createWrapper();
		const { result } = renderHook(() => useIsAuditRestricted(), { wrapper });

		await waitFor(() => {
			expect(queryClient.getQueryState(['sod-config', TENANT_ULID])?.status).toBe('success');
		});
		expect(result.current).toBe(false);
	});

	it('读取失败（null 模式）→ false（不误判受限；fail-open 语义保持）', async () => {
		useAuthStore.setState({ tenants: TENANTS, currentTenantId: TENANT_ULID, accessToken: 't' });
		mockedGet.mockRejectedValue(new Error('Network Error'));

		const { queryClient, wrapper } = createWrapper();
		const { result } = renderHook(() => useIsAuditRestricted(), { wrapper });

		await waitFor(
			() => {
				expect(queryClient.getQueryState(['sod-config', TENANT_ULID])?.status).toBe('error');
			},
			{ timeout: 5000 },
		);
		expect(result.current).toBe(false);
	});
});
