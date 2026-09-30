/**
 * secret 服务管理面 namespace（§13-A P1-B / SEC-204/207）：
 * `/secret/api/v1/admin*` 端点 fail-closed 要求 `X-Namespace ∈ 实例服务集合 S`
 * （NamespaceMiddleware，缺头/未服务 → 400）。值取部署配置 VITE_API_NAMESPACE
 * （见 config，缺省 "dev" 与服务端 DefaultNamespace 对称）。
 */

export const NAMESPACE_HEADER = 'X-Namespace';

export const SECRET_ADMIN_PATH_PREFIX = '/secret/api/v1/admin';

export function needsNamespaceHeader(url?: string): boolean {
	return !!url && url.includes(SECRET_ADMIN_PATH_PREFIX);
}
