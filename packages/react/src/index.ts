/**
 * @autional-cn/react — Autional React SDK
 *
 * 提供 React hooks 和组件，封装 @autional-cn/shared 的认证能力。
 *
 * 用法:
 * ```tsx
 * import { useAuth, useLogin } from '@autional-cn/react';
 *
 * function App() {
 *   const { isAuthenticated, user } = useAuth();
 *   const { login, logout } = useLogin();
 *   // ...
 * }
 * ```
 */

export { useAuth, useIsAuthenticated, useUser, useUserId } from './useAuth';
export { useLogin } from './useLogin';
export { useAuthActions, useAuthPermissions, useCurrentTenantId, useTenants } from './useAuth';
export type { AuthSnapshot, AuthActions } from './useAuth';
export {
  AuthService,
  AdminGuard, UserMgmtGuard, SecurityGuard, PlatformGuard, AuthGuard,
  useAuthStore, usePermission, useLogout, useBootstrap,
  useAccessToken, usePermissionsQuery, useTenantsQuery, useMeQuery,
} from '@autional-cn/shared';
export type { PermissionResult, BootstrapState } from '@autional-cn/shared';
export type { User } from '@autional-cn/shared';
