// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 回归（2026-10-03 线上四门户「未登录」）：oauth 服务的 id_token 只含 sub 等标准
// claim（无 email/username）。修复前 parseUserFromToken(id_token) 的真值结果短路了
// /auth/me 兜底，store 落残缺 user → UserMenu 显示「未登录」。

const { mockPost, mockGet, mockLoginWithTokens, mockUpdateCurrentTenant, mockPersistCid, mockTrace } =
	vi.hoisted(() => ({
		mockPost: vi.fn(),
		mockGet: vi.fn(),
		mockLoginWithTokens: vi.fn(),
		mockUpdateCurrentTenant: vi.fn(),
		mockPersistCid: vi.fn(),
		mockTrace: vi.fn(),
	}));

vi.mock('../../api/client', () => ({ apiClient: { post: mockPost, get: mockGet } }));
vi.mock('../store', () => ({ loginWithTokens: mockLoginWithTokens }));
vi.mock('../service', () => ({ AuthService: { updateCurrentTenant: mockUpdateCurrentTenant } }));
vi.mock('../oauth-client-id-store', () => ({ persistOAuthClientId: mockPersistCid }));
vi.mock('../auth-trace', () => ({ traceRedirect: mockTrace }));
vi.mock('../../config', () => ({ getPortalUrl: () => 'https://auth.example.com' }));

import { handleOAuthCallback } from '../oauth-login';

function jwt(payload: Record<string, unknown>): string {
	return `h.${btoa(JSON.stringify(payload))}.s`;
}

const ACCESS_TOKEN = jwt({ sub: 'u-1', tenant_id: 'tenant-1' });
const ME_USER = {
	id: 'u-1',
	username: '',
	email: 'demo-admin@demo.localhost',
	status: 'active',
};

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	window.history.replaceState({}, '', '/?code=test-code');
	sessionStorage.setItem('oauth_pkce_verifier', 'verifier-1');
	sessionStorage.setItem('oauth_client_id', 'cid-1');
	mockPost.mockResolvedValue({
		data: { access_token: ACCESS_TOKEN, refresh_token: 'rt-1', id_token: jwt({ sub: 'u-1' }) },
	});
	mockGet.mockResolvedValue({ data: { ...ME_USER } });
});

describe('handleOAuthCallback 用户信息解析（id_token 缺身份字段回归）', () => {
	it('id_token 只含 sub → 继续调 /auth/me，落完整 user（不再显示未登录）', async () => {
		await handleOAuthCallback();

		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(String(mockGet.mock.calls[0][0])).toBe('/identity/api/v1/auth/me');
		expect(mockGet.mock.calls[0][1]).toMatchObject({
			headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
		});
		expect(mockLoginWithTokens).toHaveBeenCalledTimes(1);
		const user = mockLoginWithTokens.mock.calls[0][2];
		expect(user.email).toBe('demo-admin@demo.localhost');
		expect(user.id).toBe('u-1');
	});

	it('id_token 含 email → 直接采信，不调 /auth/me（既有偏好保持）', async () => {
		mockPost.mockResolvedValue({
			data: {
				access_token: ACCESS_TOKEN,
				refresh_token: 'rt-1',
				id_token: jwt({ sub: 'u-1', email: 'a@b.c' }),
			},
		});

		await handleOAuthCallback();

		expect(mockGet).not.toHaveBeenCalled();
		expect(mockLoginWithTokens.mock.calls[0][2].email).toBe('a@b.c');
	});

	it('id_token 缺字段且 /auth/me 失败 → access_token JWT 兜底（id 可用）', async () => {
		mockGet.mockRejectedValue(new Error('me down'));

		await handleOAuthCallback();

		expect(mockLoginWithTokens).toHaveBeenCalledTimes(1);
		expect(mockLoginWithTokens.mock.calls[0][2].id).toBe('u-1');
	});

	it('id_token 缺失 → 同样落 /auth/me', async () => {
		mockPost.mockResolvedValue({
			data: { access_token: ACCESS_TOKEN, refresh_token: 'rt-1' },
		});

		await handleOAuthCallback();

		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(mockLoginWithTokens.mock.calls[0][2].email).toBe('demo-admin@demo.localhost');
	});
});
