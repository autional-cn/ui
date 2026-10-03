import { UI_I18N_NS, uiI18nResources } from './resources';

export { UI_I18N_NS, uiI18nResources };

/** 当前语言的内置文案；未收录的 key 返回 undefined（组件据此决定最终回落）。 */
export function uiText(lang: string | undefined, key: string): string | undefined {
	const bundle = (lang ?? '').toLowerCase().startsWith('zh')
		? uiI18nResources['zh-CN']
		: uiI18nResources['en-US'];
	return bundle[key];
}

export interface UiI18nHost {
	addResourceBundle(
		lng: string,
		ns: string,
		resources: Record<string, unknown>,
		deep?: boolean,
		overwrite?: boolean,
	): unknown;
}

/**
 * 消费站在自己的 i18n 初始化时调用一次，将组件文案注册进 i18next（ns 'autional-ui'）。
 * 注册后文案可经站点 i18next 覆盖/扩展（不注册也能工作——组件按站点语言回落内置表）：
 *   i18n.addResourceBundle(lang, 'autional-ui', { 'portal.names.admin': '...' }, true, true)
 * 短码 'zh'/'en' 一并注册：站点语言可能是裸码（如 navigator 检出的 'en'）。
 */
export function registerUiI18n(instance: UiI18nHost): void {
	for (const lng of ['zh-CN', 'zh']) {
		instance.addResourceBundle(lng, UI_I18N_NS, uiI18nResources['zh-CN'], true, false);
	}
	for (const lng of ['en-US', 'en']) {
		instance.addResourceBundle(lng, UI_I18N_NS, uiI18nResources['en-US'], true, false);
	}
}
