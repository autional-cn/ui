/**
 * useSodMode — 租户 SoD 模式 Hook
 *
 * 通过 tenant-service API 读取当前租户的 sod_mode 配置，
 * 决定 `admin` 角色对审计功能的可见性。
 *
 * 模式:
 *   'single' — 小客户模式（默认）: admin 可看 L1 统计 + L2 操作反馈
 *   'strict' — 大客户/受监管: admin 仅看 L1 统计摘要
 *
 * API: GET /tenant/api/v1/admin/tenants/{tenantId}/sod-config   （apiClient baseURL=/bff）
 *      PUT /tenant/api/v1/admin/tenants/{tenantId}/sod-config
 * {tenantId} 为租户 ULID —— 后端 GetSodConfig 按租户主键（id）查找，传 slug 必 404。
 *
 * @see document/architecture/decisions/007-security-dashboard-audit.md §2.3
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API as API_PATHS } from '../constants/api-paths';
import { extractItem } from '../utils/response';
import { useAuthStore } from '../auth/store';
import { useCurrentRole } from './useCurrentRole';

export type SodMode = 'single' | 'strict';

/**
 * 响应字段为 camelCase —— axios 响应拦截器（api/client.ts）对后端
 * `{tenant_id, sod_mode, updated_at}` 做过 camelCaseKeys 转换。
 */
interface SodConfigResponse {
	tenantId: string;
	sodMode: SodMode;
	updatedAt: string;
}

/**
 * 返回当前租户的 sod_mode。
 * 从 tenant-service 的 /admin/tenants/{ULID}/sod-config 读取（经 /bff 网关）。
 *
 * 返回 null 表示模式未知（无租户 / 加载中 / 请求失败）—— 不再折叠成 'single':
 * 'single' 仅表示服务端确认的小客户模式；请求失败经 react-query 错误通道暴露。
 * （U97: 此前路径缺 /tenant 服务段 + 传 slug + catch 吞错 + 读 snake_case 键，
 * 四连缺陷叠加使 strict 租户的审计 L2 限制恒不生效。）
 */
export function useSodMode(): SodMode | null {
	const tenantId = useAuthStore((s) => s.currentTenantId);

	const { data: config } = useQuery<SodConfigResponse | null>({
		queryKey: ['sod-config', tenantId],
		queryFn: () => fetchSodConfig(tenantId),
		staleTime: 5 * 60 * 1000, // 5 min cache
		retry: 1,
		enabled: !!tenantId,
	});

	return config?.sodMode ?? null;
}

async function fetchSodConfig(tenantId: string | null): Promise<SodConfigResponse | null> {
	if (!tenantId) return null;
	// 路径须循 /<服务>/api/v1/... 惯例（U97: 此前漏 /tenant 服务段 → 网关 404）
	const res = await apiClient.get(API_PATHS.TENANT.SOD_CONFIG(tenantId));
	return extractItem<SodConfigResponse>(res.data);
}

/**
 * 判断当前用户在 strict 模式下是否被限制查看审计详情。
 * 模式未知（null）时不判定为受限（维持既有 fail-open 语义）。
 */
export function useIsAuditRestricted(): boolean {
	const sodMode = useSodMode();
	const role = useCurrentRole();

	return useMemo(() => {
		return sodMode === 'strict' && role === 'admin';
	}, [sodMode, role]);
}
