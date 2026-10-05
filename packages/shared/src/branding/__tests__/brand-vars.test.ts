// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyBrandColors } from '../useBranding';
import { hexToTriplet, deriveDarkColor, deriveTextColor } from '../brand-color';

// U394 回归锁：品牌运行时注入必须同时写 `-rgb` 通道三元组。
// 反证：删掉 useBranding 的 setColorVar 伴随行（只写 hex），本文件断言必须 FAIL——
// 仅 hex 的品牌变量会让 Tailwind alpha 类（text-brand/60 → rgb(var(--color-brand-base-rgb)/0.6)）
// 在品牌租户下解析不到通道，整条 alpha 色静默丢失。

const ALL_VARS = [
	'--color-brand-base',
	'--color-brand-hover-base',
	'--color-brand-dark',
	'--color-brand-dark-hover',
	'--color-brand-text-base',
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
	it('合法品牌色：7 个色变量各写 hex + 三元组', () => {
		applyBrandColors('#003153');
		const s = document.documentElement.style;
		expect(s.getPropertyValue('--color-brand-base')).toBe('#003153');
		expect(s.getPropertyValue('--color-brand-base-rgb')).toBe('0 49 83');
		// AUTH-05：brand-base 白底 13.4:1 已达标 → 文本色原样；不达标色见 deriveTextColor 用例
		expect(s.getPropertyValue('--color-brand-text-base')).toBe('#003153');
		expect(s.getPropertyValue('--color-brand-text-base-rgb')).toBe('0 49 83');
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

/** WCAG 2.x 对比度（测试内独立复算，锁 AUTH-05 派生结果对白底达标） */
function contrastOnWhite(hex: string): number {
	const d = hex.replace('#', '');
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(d.slice(i, i + 2), 16) / 255);
	const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
	return 1.05 / (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) + 0.05);
}

describe('deriveTextColor — 浅底品牌文本色（AUTH-05）', () => {
	it('#1890ff（白底 3.24:1 不达标）→ 压暗至 ≥4.5:1，且不等于原值', () => {
		const out = deriveTextColor('#1890ff');
		expect(out).not.toBe('#1890ff');
		expect(contrastOnWhite(out)).toBeGreaterThanOrEqual(4.5);
	});

	it('达标输入原样返回（#003153 白底 ≈13.4:1）', () => {
		expect(deriveTextColor('#003153')).toBe('#003153');
	});

	it('#ffffff → 必然压暗且达标', () => {
		const out = deriveTextColor('#ffffff');
		expect(out).not.toBe('#ffffff');
		expect(contrastOnWhite(out)).toBeGreaterThanOrEqual(4.5);
	});

	it('非法输入 → 返回原值不抛错（N3 防御）', () => {
		expect(deriveTextColor('red')).toBe('red');
		expect(deriveTextColor('#xyz')).toBe('#xyz');
		expect(deriveTextColor('')).toBe('');
	});

	it('applyBrandColors(#1890ff)：填充不变、文本另派生（AUTH-05 核心断言）', () => {
		applyBrandColors('#1890ff');
		const s = document.documentElement.style;
		expect(s.getPropertyValue('--color-brand-base')).toBe('#1890ff');
		const textBase = s.getPropertyValue('--color-brand-text-base');
		expect(textBase).not.toBe('');
		expect(textBase).not.toBe('#1890ff');
		expect(contrastOnWhite(textBase)).toBeGreaterThanOrEqual(4.5);
	});
});
