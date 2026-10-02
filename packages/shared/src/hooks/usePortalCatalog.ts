'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAccessToken } from '../auth/store';
import { API_BASE_URL, getPortalUrl } from '../config';
import { useCurrentRole } from './useCurrentRole';

/** 平台门户目录项（映射自 tenant-service 应用列表响应，is_platform=true） */
export interface PortalCatalogEntry {
	code: string;
	name: string;
	description?: string;
	/** getPortalUrl 按 code 拼装（slug 白名单门户带租户段，域根门户落根 URL） */
	url: string;
	order: number;
	icon?: string;
}

/**
 * 数据面端点平面（网关路由隔离矩阵 §3.3）：
 * - `self`：user 受众自视图端点 `/tenants/{id}/applications`（entry_plane=api；auth/user 门户）
 * - `admin`：管理面双入口端点 `/admin/tenants/{id}/applications`（audiences [admin, platform]；
 *   admin/security/platform 控制台共用。api 平面在该路由上 403，反之亦然）
 */
export type PortalCatalogAudience = 'self' | 'admin';

export interface UsePortalCatalogOptions {
	tenantId?: string | null;
	/** 拼门户 URL 的第二参 slug（非 slug 白名单门户自动忽略，见 config.getPortalUrl） */
	slug?: string | null;
	/**
	 * 角色过滤用（仅影响 `portals`；`allPortals` 不过滤）。
	 * 缺省回退 store 当前角色（useCurrentRole）；显式 null 表示按“无角色”过滤
	 * （allowed_roles 存在的门户均不可见）。
	 */
	role?: string | null;
	audience?: PortalCatalogAudience;
	enabled?: boolean;
	exclude?: readonly string[];
}

export interface UsePortalCatalogResult {
	/** exclude 过滤 + 角色过滤 + order 升序（门户切换器 / 磁贴网格用） */
	portals: PortalCatalogEntry[];
	/** 仅 exclude 过滤、保持服务端顺序（偏好配置面板用） */
	allPortals: PortalCatalogEntry[];
	isLoading: boolean;
	isError: boolean;
	refetch: () => void;
}

const DEFAULT_EXCLUDE: readonly string[] = ['auth', 'landing'];
const PORTAL_CATALOG_STALE_TIME = 60_000;

interface RawPortalApplication {
	code: string;
	name: string;
	description?: string;
	order?: number;
	icon_url?: string;
	config?: { portal?: { allowed_roles?: readonly string[] } } | null;
}

function toEntry(app: RawPortalApplication, slug?: string): PortalCatalogEntry {
	return {
		code: app.code,
		name: app.name,
		description: app.description,
		url: getPortalUrl(app.code, slug),
		order: app.order ?? 0,
		icon: app.icon_url,
	};
}

/**
 * 平台门户目录（应用清单，is_platform=true 全租户同集）。
 * 消费侧按所在控制台平面传 audience；403/网络失败 → isError（不静默吞），
 * 调用方可据此降级（隐藏切换器或静态兜底）。
 */
export function usePortalCatalog(options: UsePortalCatalogOptions = {}): UsePortalCatalogResult {
	const {
		tenantId,
		slug,
		role: roleProp,
		audience = 'self',
		enabled = true,
		exclude = DEFAULT_EXCLUDE,
	} = options;
	const token = getAccessToken();
	const currentRole = useCurrentRole();
	const role = roleProp !== undefined ? roleProp : currentRole;

	const query = useQuery({
		// slug 只影响 URL 拼装（memo 层），不进 key：同一份目录不随 slug 重复拉取
		queryKey: ['portal-catalog', audience, tenantId],
		staleTime: PORTAL_CATALOG_STALE_TIME,
		retry: false,
		enabled: enabled && !!tenantId && !!token,
		queryFn: async (): Promise<RawPortalApplication[]> => {
			const apiPrefix = audience === 'admin' ? '/tenant/api/v1/admin' : '/tenant/api/v1';
			const res = await fetch(
				`${API_BASE_URL}${apiPrefix}/tenants/${tenantId}/applications?type=portal&is_platform=true&status=active`,
				{ headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } },
			);
			const body = await res.json().catch(() => null);
			if (!res.ok || body?.code !== 0) {
				throw new Error(body?.message || `portal catalog request failed (HTTP ${res.status})`);
			}
			// tenant-service 分页形状为 { items: [...] }，部分路径为 { data: [...] }
			if (Array.isArray(body.data)) return body.data;
			if (Array.isArray(body.items)) return body.items;
			return [];
		},
	});

	// exclude 过滤后保持服务端顺序（偏好配置面板要能配置全部门户，不做角色过滤）
	const excludedPortals = useMemo(() => {
		const excluded = new Set(exclude);
		return (query.data ?? []).filter((app) => !excluded.has(app.code));
	}, [query.data, exclude]);

	const allPortals = useMemo(
		() => excludedPortals.map((app) => toEntry(app, slug || undefined)),
		[excludedPortals, slug],
	);

	// 角色过滤 + order 升序（门户切换器 / 磁贴网格用）：
	// allowed_roles 缺省 = 全员可见；存在则须含当前角色（与 auth dashboard 旧口径一致）
	const portals = useMemo(
		() =>
			excludedPortals
				.filter((app) => {
					const allowedRoles = app.config?.portal?.allowed_roles;
					return !allowedRoles || allowedRoles.includes(role ?? '');
				})
				.map((app) => toEntry(app, slug || undefined))
				.sort((a, b) => a.order - b.order),
		[excludedPortals, slug, role],
	);

	return {
		portals,
		allPortals,
		isLoading: query.isLoading,
		isError: query.isError,
		refetch: query.refetch,
	};
}
