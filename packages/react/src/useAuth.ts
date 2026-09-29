/**
 * @autional-cn/react — useAuth
 *
 * 基于 @autional-cn/shared 的 useAuth hook，提供 React-specific 的认证状态管理。
 * 对齐博客文档中规划的 API: const { isAuthenticated, user } = useAuth();
 *
 * @see https://docs.autional.com/blog/oauth2-pkce
 */

'use client';

export {
  useAuth, useAuthActions, useIsAuthenticated, useUser, useUserId,
  useAccessToken, useAuthPermissions, useCurrentTenantId, useTenants,
} from '@autional-cn/shared';
export type { AuthSnapshot, AuthActions } from '@autional-cn/shared';
