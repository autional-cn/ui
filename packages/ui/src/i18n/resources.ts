/**
 * @autional-cn/ui 组件文案的单一出处（i18n 资源形态，扁平点键——对齐消费站
 * `keySeparator: false` 的扁平键约定）。
 *
 * 消费站在自己的 i18n 初始化时调用 `registerUiI18n(i18n)` 注册本表；未注册时
 * 组件按站点当前语言直接回落本表（i18next defaultValue），行为一致。
 * 门户名措辞对齐 auth dashboard 的 `dashboard.*` 口径（同一门户一处名字）。
 */

export const UI_I18N_NS = 'autional-ui';

export const uiI18nResources: Record<'zh-CN' | 'en-US', Record<string, string>> = {
	'zh-CN': {
		'portal.switcher': '切换门户',
		'portal.names.admin': '管理后台',
		'portal.names.auth': '登录中心',
		'portal.names.security': '安全中心',
		'portal.names.user': '用户中心',
		'portal.names.authenticator': '身份验证器应用',
		'portal.names.status': '状态页',
		'portal.names.trust': '信任中心',
		'portal.names.platform': '平台控制台',
		'portal.names.developer': '开发者门户',
		'portal.names.landing': '门户首页',
		'portal.names.brand': '品牌站',
	},
	'en-US': {
		'portal.switcher': 'Switch portal',
		'portal.names.admin': 'Admin Console',
		'portal.names.auth': 'Sign-in',
		'portal.names.security': 'Security Dashboard',
		'portal.names.user': 'End-User Portal',
		'portal.names.authenticator': 'Authenticator App',
		'portal.names.status': 'Status Page',
		'portal.names.trust': 'Trust Center',
		'portal.names.platform': 'Platform Console',
		'portal.names.developer': 'Developer Portal',
		'portal.names.landing': 'Home',
		'portal.names.brand': 'Brand Site',
	},
};
