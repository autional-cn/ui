// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthStore } from '../../auth/store';
import { useCurrentTenantIdOr } from '../useCurrentTenantIdOr';

// 这个 hook 存在的理由就是**回落链的三段**，所以三段各验一条：
//   已选租户 → 用它；未选但列表非空 → tenants[0]（BUG-013 的修法）；都没有 → 调用方给的 fallback。
// 顺带锁死「同名两种语义」那个坑：platform 原来直接返回 fallback、不取 tenants[0]。
const T = (id: string) => ({ id, name: id, role: 'admin' });

describe('useCurrentTenantIdOr', () => {
	beforeEach(() => {
		useAuthStore.setState({ currentTenantId: null, tenants: [] } as never);
	});

	it('已选租户时用当前租户', () => {
		useAuthStore.setState({ currentTenantId: 't-current', tenants: [T('t-current'), T('t-other')] } as never);
		const { result } = renderHook(() => useCurrentTenantIdOr('fallback'));
		expect(result.current).toBe('t-current');
	});

	it('未选租户但列表非空：回落 tenants[0]（不直接用 fallback）', () => {
		useAuthStore.setState({ currentTenantId: null, tenants: [T('t-first'), T('t-second')] } as never);
		const { result } = renderHook(() => useCurrentTenantIdOr('fallback'));
		expect(result.current).toBe('t-first');
	});

	it('连租户列表都空：才用调用方给的 fallback', () => {
		const { result } = renderHook(() => useCurrentTenantIdOr('fallback'));
		expect(result.current).toBe('fallback');
	});

	it('fallback 传空串时得到空串（「无租户」的一种显式表示）', () => {
		const { result } = renderHook(() => useCurrentTenantIdOr(''));
		expect(result.current).toBe('');
	});
});
