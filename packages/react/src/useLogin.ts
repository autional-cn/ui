/**
 * @autional-cn/react — useLogin
 *
 * 登录/登出 Hook。对齐博客文档中规划的 API:
 *   const { login, logout, isAuthenticated } = useLogin();
 *   await login({ clientId: 'myapp', redirectUri: 'https://myapp.com/callback' });
 *
 * @see https://docs.autional.com/blog/oauth2-pkce
 */

'use client';

import { useCallback } from 'react';
import { AuthService, useAuth } from '@autional-cn/shared';

export function useLogin() {
  const { isAuthenticated } = useAuth();

  const login = useCallback(async (params?: {
    clientId?: string;
    redirectUri?: string;
  }): Promise<void> => {
    const { initiateOAuthLogin } = await import('@autional-cn/shared');
    if (params?.clientId) {
      return initiateOAuthLogin(params.clientId, params.redirectUri);
    }
    // 无参数时跳转到 auth-pages 登录页
    const { buildLoginUrl } = await import('@autional-cn/shared');
    window.location.href = buildLoginUrl(window.location.href);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await AuthService.logout();
    const { buildLoginUrl } = await import('@autional-cn/shared');
    // 传当前 URL 作为 returnUrl，保留租户 slug（与 useLogout 一致）
    window.location.href = buildLoginUrl(window.location.href);
  }, []);

  return { login, logout, isAuthenticated };
}
