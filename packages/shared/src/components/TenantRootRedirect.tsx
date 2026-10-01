import { useEffect, useMemo } from 'react';
import { useCurrentTenantId } from '../hooks/useAuth';
import { getPortalUrl } from '../config';
import { traceRedirect } from '../auth/auth-trace';
import { usePublicTenantSlugs } from './TenantIndexGuard';

/**
 * 裸根 `/` 漏斗：门户入口必须带租户段（/:tenantSlug）。
 * - 已有会话且能解析出 slug → 整页跳 /<slug>/（不经过 brand）
 * - 否则整页跳 brand 选品牌（brand → auth 登录 → 回本门户 /<slug>/）
 *
 * slug 解析**唯一权威 = 公开租户名单**（id → name，name 即 slug）。
 * 不得用会话 store 的 tenants[].name —— 那是 identity `/auth/me/tenants` 的
 * **展示名**（如 "Demo Tenant"），拼进 URL 会落 /Demo%20Tenant/ → 404（回归修复；
 * 与 auth 站 8859e4d 的 pickSessionSlug 同口径）。
 *
 * 注：本包刻意不依赖 react-router（它只属于各 app），故不走 <Navigate>。
 */
export function TenantRootRedirect() {
	const currentTenantId = useCurrentTenantId();
	const { data: knownTenants, isSuccess: tenantsLoaded } = usePublicTenantSlugs();

	const slug = useMemo(() => {
		if (!currentTenantId || !tenantsLoaded) return undefined;
		const match = (knownTenants ?? []).find((t) => t.id === currentTenantId);
		return match?.name || match?.slug || undefined;
	}, [currentTenantId, knownTenants, tenantsLoaded]);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		if (slug) {
			const base = window.location.pathname.replace(/\/+$/, '');
			traceRedirect(`${base}/${slug}/`, { reason: 'funnel-slug' });
			return;
		}
		// 有会话但公开名单尚未返回：等待（名单是 slug 唯一权威，不得抢跑漏斗 brand）。
		// 无会话（currentTenantId 空）不受此闸，立即漏斗。
		if (currentTenantId && !tenantsLoaded) return;
		const brand = getPortalUrl('brand');
		// 门户不可派生（如经 IP 主机访问）：保持当前页，不导航（与 EntryRouter 同约定）
		if (!brand) return;
		const target = `${brand}/?redirect=${encodeURIComponent(
			window.location.origin + window.location.pathname,
		)}`;
		traceRedirect(target, { reason: 'funnel-brand' });
	}, [slug, currentTenantId, tenantsLoaded]);

	return null;
}
