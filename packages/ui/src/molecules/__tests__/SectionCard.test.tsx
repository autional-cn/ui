import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SectionCard } from '../SectionCard';

describe('SectionCard', () => {
	it('渲染标题与内容，标题是 h2', () => {
		render(<SectionCard title="区块标题">内容</SectionCard>);
		const h2 = screen.getByRole('heading', { level: 2 });
		expect(h2.textContent).toBe('区块标题');
		expect(screen.getByText('内容')).toBeTruthy();
	});

	it('没有 title 时不渲染空的标题容器', () => {
		const { container } = render(<SectionCard>只有内容</SectionCard>);
		expect(container.querySelector('h2')).toBeNull();
	});

	it('区块标题是契约里的那一档：text-base font-semibold（不是页面标题的 text-xl，也不是 font-bold）', () => {
		// 依据：控制台那 363 张 antd Card 的 head title 是 antd 的 fontSizeLG/600 = 16/600；
		// 而页面标题（ConsolePageHeader）是 20/600 —— 区块标题既不该与它同尺寸，也不该比它更重。
		render(<SectionCard title="区块标题">内容</SectionCard>);
		const h2 = screen.getByRole('heading', { level: 2 });
		expect(h2.className).toContain('text-base');
		expect(h2.className).toContain('font-semibold');
		expect(h2.className).not.toContain('font-bold');
		expect(h2.className).not.toContain('text-xl');
	});

	it('圆角走设计系统的 radius-lg 档位（24px），不用 Tailwind 出厂的 rounded-2xl', () => {
		// 依据：DESIGN.md §9「cards radius-lg (24px)」+ primitives.css 的 .brand-card 用 --radius-lg。
		// 类型在运行时被抹掉，所以直接读源码做证否式断言：写回 rounded-2xl / rounded-xl 这条会红。
		const raw = readFileSync(join(process.cwd(), 'src', 'molecules', 'SectionCard.tsx'), 'utf8');
		// **先剥注释再断言**：这条纪律在这份计划里已经踩过五次了 —— 组件顶上那段解释「为什么从 rounded-2xl
		// 改过来」的注释本身就会被这条断言命中（第一版就是这么红的）。
		const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
		expect(src).toContain('rounded-lg');
		expect(src).not.toContain('rounded-2xl');
		expect(src).not.toContain('rounded-xl');
	});

	it('内边距四档：none / sm(p-4) / md(p-6) / lg(p-8)，默认 md', () => {
		const { container: a } = render(<SectionCard>a</SectionCard>);
		expect((a.firstElementChild as HTMLElement).className).toContain('p-6');
		const { container: b } = render(<SectionCard padding="none">b</SectionCard>);
		expect((b.firstElementChild as HTMLElement).className).not.toMatch(/\bp-[0-9]/);
		const { container: c } = render(<SectionCard padding="sm">c</SectionCard>);
		expect((c.firstElementChild as HTMLElement).className).toContain('p-4');
		const { container: d } = render(<SectionCard padding="lg">d</SectionCard>);
		expect((d.firstElementChild as HTMLElement).className).toContain('p-8');
	});

	it('className 是追加而不是覆盖（容器的底色/边框/圆角不能被调用方悄悄换掉）', () => {
		const { container } = render(<SectionCard className="mt-6 text-center">x</SectionCard>);
		const cls = (container.firstElementChild as HTMLElement).className;
		expect(cls).toContain('mt-6');
		expect(cls).toContain('text-center');
		expect(cls).toContain('bg-[var(--color-bg-surface)]');
		expect(cls).toContain('border-[var(--color-border-subtle)]');
	});
});
