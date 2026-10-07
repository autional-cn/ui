import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';

// 第 59 轮：Input 加了 prefix / suffix 两个槽 —— 为了替掉舰队里手抄 6 遍的
// 「relative 容器 + 绝对定位图标 + 算出来的 pl-9」。
// 两条断言各自的理由：
//   ① 有槽时**不许**出现魔法内边距（pl-9 一类）—— 那正是这次要消灭的东西；
//   ② 无槽时渲染必须**逐字节回到旧形态**（h-10 在 input 自己身上）—— 既有消费方零影响。
describe('Input', () => {
	it('有 prefix 时用 flex 排布，不引入算出来的内边距', () => {
		const { container } = render(<Input prefix={<span data-testid="ico">i</span>} placeholder="p" />);
		const input = screen.getByPlaceholderText('p');
		const wrapper = container.querySelector('div.w-full > div');
		expect(wrapper?.className).toContain('flex');
		expect(input.className).not.toMatch(/\bpl-\d/);
		expect(wrapper?.className).not.toMatch(/\bpl-\d/);
		expect(screen.getByTestId('ico')).toBeTruthy();
	});

	it('无槽时渲染回旧形态：高度在 input 自己身上，且没有 wrapper 的 flex 外框', () => {
		const { container } = render(<Input placeholder="q" />);
		const input = screen.getByPlaceholderText('q');
		expect(input.className).toContain('h-10');
		expect(container.querySelector('div.w-full > div')).toBeNull();
	});

	it('suffix 与 error 可以共存', () => {
		render(<Input suffix={<span data-testid="suf">x</span>} error="必填" />);
		expect(screen.getByTestId('suf')).toBeTruthy();
		expect(screen.getByText('必填')).toBeTruthy();
	});
});
