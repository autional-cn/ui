/**
 * 字段名大小写转换工具
 * 后端 Go 返回 PascalCase，前端统一使用 camelCase
 */

import { camelCase, isPlainObject, isArray } from 'lodash-es';

/**
 * 递归将对象的所有键从 PascalCase/snake_case 转换为 camelCase
 */
export function camelCaseKeys<T>(obj: T): T {
	if (isArray(obj)) {
		return obj.map(camelCaseKeys) as unknown as T;
	}
	if (!isPlainObject(obj) || obj === null) {
		return obj;
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		result[camelCase(key)] = camelCaseKeys(value);
	}
	return result as T;
}

/**
 * 单个键 camelCase → snake_case（acronym-aware）。
 * U385：朴素正则（每个大写字母前插 `_`）会把缩写拆散——clientDataJSON →
 * client_data_j_s_o_n、userID → user_i_d——WebAuthn 请求体（camel 书面键）经拦截器后
 * 键名 mangling，服务端 go-webauthn 判为缺字段、校验恒败。两步修正：
 *   ① 小写/数字 → 大写 边界插 `_`（aB → a_B）；
 *   ② 连续大写后紧跟「大写+小写」时在缩写尾部插 `_`（JSONValue → JSON_Value）。
 * 已是 snake 的字面量键（含下划线/无大写）两步均不命中，原样保留。
 */
function toSnakeKey(key: string): string {
	return key
		.replace(/([a-z\d])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase();
}

/**
 * 递归将对象的所有键从 camelCase 转换为 snake_case
 * 用于发送请求到后端
 */
export function snakeCaseKeys<T>(obj: T): T {
	if (isArray(obj)) {
		return obj.map(snakeCaseKeys) as unknown as T;
	}
	if (!isPlainObject(obj) || obj === null) {
		return obj;
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		result[toSnakeKey(key)] = snakeCaseKeys(value);
	}
	return result as T;
}
