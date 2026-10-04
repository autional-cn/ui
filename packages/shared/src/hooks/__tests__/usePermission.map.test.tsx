// @vitest-environment jsdom
// TASK-AB1-12（fix-admin-b1-guard-contract / A-444①③ · RC-6 · D4 补二裁一）：
// PERMISSION_MAP 映射层回归锁 —— 观测口径 = can()（hook 不暴露 effectivePerms，can 即映射结果函数）。
// 码集 = service-rbac db/seeds/platform_rbac.go 实际 seed：
//   security_admin（11 码）/ user_manager / member / guest。
//
// 覆盖：B1 裁撤（user:read 去 tenant:user:read）+ B2 裁撤（role:read 去 tenant:role:read）
//       + D4 补源（agent/robot/device:read → tenant:nhi:read；status:read → tenant:monitor:read；
//         oauth:read → tenant:oauth:read）+ billing 不补（负向）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAuthStore } from '../../auth/store';
import { usePermission } from '../usePermission';

const SECURITY_ADMIN_CODES = [
	'audit:read',
	'compliance:read',
	'role:read',
	'session:read',
	'user:read',
	'status:read',
	'oauth:read',
	'agent:read',
	'robot:read',
	'robot:health:read',
	'device:read',
];
const USER_MANAGER_CODES = ['profile:read', 'user:create', 'user:delete', 'user:read', 'user:update'];
const MEMBER_CODES = ['profile:read', 'user:read'];
const GUEST_CODES = ['user:read'];

/** 重置 store + localStorage，避免跨用例污染。 */
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

/** 挂载 hook 并以非 admin 角色播种码集（admin 角色会走 tenant:* 前缀豁免，无法判别映射）。 */
function mountCan(role: string, permissions: string[]) {
	const { result } = renderHook(() => usePermission());
	act(() => {
		useAuthStore.setState({
			tenants: [{ id: 'tenant-a', name: 'Tenant A', role }],
			currentTenantId: 'tenant-a',
			permissions,
		});
	});
	return (p: string) => result.current.can(p);
}

describe('AB1-12 映射表（AC-AB1-24）', () => {
	beforeEach(() => {
		resetAuthStore();
	});

	afterEach(() => {
		cleanup();
		resetAuthStore();
	});

	describe('B1 裁撤：user:read 去掉 tenant:user:read', () => {
		it('user_manager 经 user:create 仍见 /users（不回归）', () => {
			const can = mountCan('user_manager', USER_MANAGER_CODES);
			expect(can('tenant:user:read')).toBe(true);
		});

		it('user_manager 保留 user:read 的其余映射（dashboard/self:profile）', () => {
			const can = mountCan('user_manager', USER_MANAGER_CODES);
			expect(can('tenant:dashboard:read')).toBe(true);
			expect(can('self:profile:read')).toBe(true);
		});

		it('member 不显 /users（仅 user:read，无映射源）', () => {
			const can = mountCan('member', MEMBER_CODES);
			expect(can('tenant:user:read')).toBe(false);
		});

		it('member 仍持 user:read 的保留映射（dashboard）——裁撤只摘一个目标键', () => {
			const can = mountCan('member', MEMBER_CODES);
			expect(can('tenant:dashboard:read')).toBe(true);
		});

		it('guest 不显 /users', () => {
			const can = mountCan('guest', GUEST_CODES);
			expect(can('tenant:user:read')).toBe(false);
		});
	});

	describe('B2 裁撤：role:read 去掉 tenant:role:read', () => {
		it('security_admin 不显 /roles 与 /role-activations（同键双面）', () => {
			const can = mountCan('security_admin', SECURITY_ADMIN_CODES);
			expect(can('tenant:role:read')).toBe(false);
		});

		it('security_admin 的 audit/compliance 读面不回归（audit:read 映射保留）', () => {
			const can = mountCan('security_admin', SECURITY_ADMIN_CODES);
			expect(can('tenant:audit:read')).toBe(true);
			expect(can('tenant:compliance:read')).toBe(true);
		});
	});

	describe('D4 补源：三组新映射逐码可授予', () => {
		it('agent:read / robot:read / device:read 各自可授予 tenant:nhi:read（NHI 父键+叶）', () => {
			for (const code of ['agent:read', 'robot:read', 'device:read']) {
				const can = mountCan('member', [code]);
				expect(can('tenant:nhi:read'), `code=${code}`).toBe(true);
			}
		});

		it('status:read ⇒ tenant:monitor:read（/status）', () => {
			const can = mountCan('security_admin', ['status:read']);
			expect(can('tenant:monitor:read')).toBe(true);
		});

		it('oauth:read ⇒ tenant:oauth:read（/oauth-clients）', () => {
			const can = mountCan('security_admin', ['oauth:read']);
			expect(can('tenant:oauth:read')).toBe(true);
		});

		it('security_admin 全码集下三组补源同时生效', () => {
			const can = mountCan('security_admin', SECURITY_ADMIN_CODES);
			expect(can('tenant:nhi:read')).toBe(true);
			expect(can('tenant:monitor:read')).toBe(true);
			expect(can('tenant:oauth:read')).toBe(true);
		});
	});

	describe('负向：不越权 + billing 不补', () => {
		it('补源不外溢：status:read 不授予 tenant:user:read / tenant:role:read / tenant:nhi:read', () => {
			const can = mountCan('security_admin', ['status:read']);
			expect(can('tenant:user:read')).toBe(false);
			expect(can('tenant:role:read')).toBe(false);
			expect(can('tenant:nhi:read')).toBe(false);
		});

		it('billing 不补（D4 裁撤）：security_admin 全码集也拿不到 tenant:billing:read', () => {
			const can = mountCan('security_admin', SECURITY_ADMIN_CODES);
			expect(can('tenant:billing:read')).toBe(false);
		});

		it('security_admin 全码集下 tenant:user:read / tenant:role:read 均为 false（双裁撤复核）', () => {
			const can = mountCan('security_admin', SECURITY_ADMIN_CODES);
			expect(can('tenant:user:read')).toBe(false);
			expect(can('tenant:role:read')).toBe(false);
		});
	});
});
