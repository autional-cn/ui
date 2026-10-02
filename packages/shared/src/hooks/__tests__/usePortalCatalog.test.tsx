// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePortalCatalog } from '../usePortalCatalog';
import { useAuthStore } from '../../auth/store';

/** 每测试独立 QueryClient（同一 wrapper 引用，避免缓存跨用例串扰） */
function makeWrapper() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: React.ReactNode }) {
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	};
}

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

const okJson = (body: unknown, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

let fetchMock: ReturnType<typeof vi.fn>;

const CALL_URL = (call: number) => String(fetchMock.mock.calls[call]![0]);
const CALL_INIT = (call: number) =>
	fetchMock.mock.calls[call]![1] as { headers: Record<string, string> };

describe('usePortalCatalog', () => {
	beforeEach(() => {
		resetAuthStore();
		useAuthStore.setState({ accessToken: 'test-token' });
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		cleanup();
		resetAuthStore();
		vi.unstubAllGlobals();
	});

	it('self 端点：data[] 解析、默认排除 auth/landing、order 升序、URL 按 slug 拼装', async () => {
		fetchMock.mockResolvedValue(
			okJson({
				code: 0,
				data: [
					{ code: 'auth', name: 'Sign-in', order: 1 },
					{ code: 'user', name: '用户门户', order: 3 },
					{ code: 'admin', name: '管理控制台', order: 1, icon_url: 'https://cdn.example/icon.svg' },
					{ code: 'landing', name: 'Home', order: 9 },
				],
			}),
		);
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1', slug: 'acme-corp' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(CALL_URL(0)).toBe(
			'/bff/tenant/api/v1/tenants/t1/applications?type=portal&is_platform=true&status=active',
		);
		expect(CALL_INIT(0).headers.Authorization).toBe('Bearer test-token');

		// allPortals：仅排除、保持服务端顺序
		expect(result.current.allPortals.map((p) => p.code)).toEqual(['user', 'admin']);
		// portals：order 升序（admin=1, user=3）
		expect(result.current.portals.map((p) => p.code)).toEqual(['admin', 'user']);
		const admin = result.current.portals.find((p) => p.code === 'admin')!;
		expect(admin.url).toBe('http://admin.localhost/acme-corp');
		expect(admin.icon).toBe('https://cdn.example/icon.svg');
		expect(result.current.isError).toBe(false);
	});

	it('items[] 分页形状容错（tenant-service 实际形状）', async () => {
		fetchMock.mockResolvedValue(
			okJson({ code: 0, items: [{ code: 'admin', name: '管理控制台', order: 2 }] }),
		);
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.portals).toHaveLength(1));
		expect(result.current.portals[0]!.code).toBe('admin');
	});

	it('业务失败（code!==0）→ isError 且不产出条目', async () => {
		fetchMock.mockResolvedValue(okJson({ code: 40000503, message: 'plane forbidden' }));
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(result.current.portals).toEqual([]);
		expect(result.current.allPortals).toEqual([]);
	});

	it('HTTP 403（body 非 JSON）→ isError（平面错配可降级）', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 403,
			json: async () => {
				throw new Error('not json');
			},
		});
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.isError).toBe(true));
	});

	it('fetch 网络异常 → isError', async () => {
		fetchMock.mockRejectedValue(new Error('network down'));
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.isError).toBe(true));
	});

	it('tenantId / token / enabled 任一缺省 → 不发请求', async () => {
		renderHook(() => usePortalCatalog({ tenantId: null }), { wrapper: makeWrapper() });
		expect(fetchMock).not.toHaveBeenCalled();

		resetAuthStore();
		renderHook(() => usePortalCatalog({ tenantId: 't1' }), { wrapper: makeWrapper() });
		expect(fetchMock).not.toHaveBeenCalled();

		useAuthStore.setState({ accessToken: 'test-token' });
		renderHook(() => usePortalCatalog({ tenantId: 't1', enabled: false }), {
			wrapper: makeWrapper(),
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('audience=admin → 管理面双入口路径（admin/security/platform 控制台）', async () => {
		fetchMock.mockResolvedValue(okJson({ code: 0, data: [] }));
		renderHook(() => usePortalCatalog({ tenantId: 't1', audience: 'admin' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(CALL_URL(0)).toBe(
			'/bff/tenant/api/v1/admin/tenants/t1/applications?type=portal&is_platform=true&status=active',
		);
	});

	it('exclude 自定义：仅过滤指定 code（不叠加默认排除）', async () => {
		fetchMock.mockResolvedValue(
			okJson({
				code: 0,
				data: [
					{ code: 'admin', name: 'a', order: 1 },
					{ code: 'auth', name: 'b', order: 2 },
				],
			}),
		);
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1', exclude: ['admin'] }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.allPortals).toHaveLength(1));
		expect(result.current.allPortals[0]!.code).toBe('auth');
	});

	it('非 slug 白名单门户（status）不拼租户段', async () => {
		fetchMock.mockResolvedValue(
			okJson({ code: 0, data: [{ code: 'status', name: '状态页', order: 1 }] }),
		);
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1', slug: 'acme-corp' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.portals).toHaveLength(1));
		expect(result.current.portals[0]!.url).toBe('http://status.localhost');
	});

	it('角色过滤：allowed_roles 缺省全员可见；存在则须含当前角色（allPortals 不受角色过滤）', async () => {
		fetchMock.mockResolvedValue(
			okJson({
				code: 0,
				data: [
					{
						code: 'admin',
						name: '管理控制台',
						order: 2,
						config: { portal: { allowed_roles: ['admin', 'super_admin'] } },
					},
					{ code: 'user', name: '用户门户', order: 1, config: { portal: { allowed_roles: ['user'] } } },
					{ code: 'developer', name: '开发者门户', order: 3 },
				],
			}),
		);
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1', role: 'user' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.allPortals).toHaveLength(3));

		// portals：角色过滤 + order 升序（developer 无 allowed_roles = 全员可见）
		expect(result.current.portals.map((p) => p.code)).toEqual(['user', 'developer']);
		// allPortals：仅 exclude，保持服务端顺序（偏好面板要能配置全部门户）
		expect(result.current.allPortals.map((p) => p.code)).toEqual(['admin', 'user', 'developer']);
	});

	it('role 缺省回退 store 当前角色（useCurrentRole）', async () => {
		useAuthStore.setState({
			tenants: [{ id: 't1', name: 'demo', role: 'super_admin' }],
			currentTenantId: 't1',
		});
		fetchMock.mockResolvedValue(
			okJson({
				code: 0,
				data: [
					{
						code: 'admin',
						name: '管理控制台',
						order: 1,
						config: { portal: { allowed_roles: ['super_admin'] } },
					},
					{ code: 'user', name: '用户门户', order: 2, config: { portal: { allowed_roles: ['user'] } } },
				],
			}),
		);
		const { result } = renderHook(() => usePortalCatalog({ tenantId: 't1' }), {
			wrapper: makeWrapper(),
		});
		await waitFor(() => expect(result.current.portals).toHaveLength(1));
		expect(result.current.portals[0]!.code).toBe('admin');
	});
});
