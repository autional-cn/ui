'use client';

// 当前租户 ID 的**带显式回落**版本。
//
// 为什么需要它（而不是让各门户各写一份）：admin 与 platform 各有一份 hooks/use-tenant.ts，
// 同名同签名、语义却不同 —— admin 的 useTenantIdOr 会回落 tenants[0]，platform 的直接返回入参。
// 那个差别不是风格：admin 的注释记着 BUG-013（硬编码 'default-tenant' 导致 data-classification 等页 404），
// 而 tenants[0] 是「已登录但没选租户」时唯一正确的答案。同一个函数名两种语义，迟早会有人在错误的那份上写新功能。
//
// 与 useCurrentTenantId() 的分工：那个是**只读、可空、诚实**的窄 hook（无租户就是 null）；
// 这个在调用方确实需要一个字符串时用，并且**把回落值写在调用点上** —— 让「没有租户时会发生什么」看得见。

import { useCurrentTenantId } from './useAuth';
import { useTenants } from './useAuth';

/**
 * 当前租户 ID，缺失时回落：已登录但未选租户 → 取 tenants[0].id；连租户列表都空 → 用调用方给的 fallback。
 *
 * 用法：
 *   const tenantId = useCurrentTenantIdOr('');          // 明确接受「空字符串」这一种无租户表示
 *   const tenantId = useCurrentTenantIdOr('default');   // 或给一个明确的兜底
 */
export function useCurrentTenantIdOr(fallback: string): string {
	const currentTenantId = useCurrentTenantId();
	const tenants = useTenants();
	if (currentTenantId) return currentTenantId;
	if (tenants && tenants.length > 0 && tenants[0].id) return tenants[0].id;
	return fallback;
}
