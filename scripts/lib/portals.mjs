// 在册门户清单 —— 唯一一份。
//
// 第 29 轮提取：这份清单此前在 check-shell / check-typecheck / check-lint 里各写了一遍
// （三份内容相同、注释不同），而本轮要加第四道用到它的闸门。
// 「四份同源清单」正是本计划 §1 一直在收的那类漂移 —— 与其写第四份，不如先把它收成一份。
//
// 「在册」= 与设计系统的外壳/组件/令牌有契约关系的门户（§1.3 的外壳表同一批）。
// 其余 10 个站（web / developer / status / docs / auth / …）不在这些契约范围内。
export const PORTALS = [
	{ site: 'admin', app: 'apps/admin-console' },
	{ site: 'platform', app: 'apps/platform-console' },
	{ site: 'security', app: 'apps/security-dashboard' },
	{ site: 'user', app: 'apps/end-user-portal' }
];
