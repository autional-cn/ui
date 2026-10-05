// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyBrandColors } from '../useBranding';
import { hexToTriplet, deriveDarkColor } from '../brand-color';

// U394 回归锁：品牌运行时注入必须同时写 `-rgb` 通道三元组。
// 反证：删掉 useBranding 的 setColorVar 伴随行（只写 hex），本文件断言必须 FAIL——
// 仅 hex 的品牌变量会让 Tailwind alpha 类（text-brand/60 → rgb(var(--color-brand-base-rgb)/0.6)）
// 在品牌租户下解析不到通道，整条 alpha 色静默丢失。

const ALL_VARS = [
	'--color-brand-base',
	'--color-brand-hover-base',
	'--color-brand-dark',
	'--color-brand-dark-hover',
	'--color-on-brand-base',
	'--color-on-brand',
	'--color-on-brand-dark',
];

beforeEach(() => {
	document.documentElement.removeAttribute('style');
});

describe('hexToTriplet', () => {
	it('6 位 hex → 空格分隔三元组', () => {
		expect(hexToTriplet('#003153')).toBe('0 49 83');
		expect(hexToTriplet('#ffffff')).toBe('255 255 255');
	});

	it('3 位缩写与大写归一', () => {
		expect(hexToTriplet('#123')).toBe('17 34 51');
		expect(hexToTriplet('#FFBF00')).toBe('255 191 0');
	});

	it('非法输入 → null，不抛错（N3 防御）', () => {
		expect(hexToTriplet('red')).toBeNull();
		expect(hexToTriplet('#xyz')).toBeNull();
		expect(hexToTriplet('')).toBeNull();
	});
});

describe('applyBrandColors — -rgb 伴随写入', () => {
	it('合法品牌色：6 个色变量各写 hex + 三元组', () => {
		applyBrandColors('#003153');
		const s = document.documentElement.style;
		expect(s.getPropertyValue('--color-brand-base')).toBe('#003153');
		expect(s.getPropertyValue('--color-brand-base-rgb')).toBe('0 49 83');
		expect(s.getPropertyValue('--color-brand-hover-base-rgb')).toBe('0 49 83');
		expect(s.getPropertyValue('--color-brand-dark-rgb')).toBe(hexToTriplet(deriveDarkColor('#003153')));
		expect(s.getPropertyValue('--color-brand-dark-hover-rgb')).not.toBe('');
		expect(s.getPropertyValue('--color-on-brand-base-rgb')).toBe('255 255 255');
		expect(s.getPropertyValue('--color-on-brand-dark-rgb')).not.toBe('');
	});

	it('darkOverride 生效时 base 与 dark 三元组各自独立', () => {
		applyBrandColors('#003153', '#87ceeb');
		const s = document.documentElement.style;
		expect(s.getPropertyValue('--color-brand-base-rgb')).toBe('0 49 83');
		expect(s.getPropertyValue('--color-brand-dark-rgb')).toBe('135 206 235');
	});

	it('清空（空串）：所有基础变量与 -rgb 伴随一并移除', () => {
		applyBrandColors('#003153');
		applyBrandColors('');
		const s = document.documentElement.style;
		for (const v of ALL_VARS) {
			expect(s.getPropertyValue(v), v).toBe('');
			expect(s.getPropertyValue(`${v}-rgb`), `${v}-rgb`).toBe('');
		}
	});

	it('非 hex 值：写原值但移除 -rgb（不残留上一租户通道）', () => {
		applyBrandColors('#003153');
		applyBrandColors('red');
		const s = document.documentElement.style;
		expect(s.getPropertyValue('--color-brand-base')).toBe('red');
		expect(s.getPropertyValue('--color-brand-base-rgb')).toBe('');
	});
});
