import React from 'react';

// SectionCard —— 区块容器（带标题的卡片）。
//
// 第 30 轮把它的两处规格改回设计系统自己的口径（此前两处都是 Tailwind 出厂值，不是设计系统的档位）：
//   · 圆角 `rounded-2xl`（16px）→ `rounded-lg`（24px）：DESIGN.md §9 写的是「cards `radius-lg` (24px)」，
//     `primitives.css` 的 `.brand-card` 用的也是 `--radius-lg`，而 user 门户 62 处手写卡片同样是 24px
//     —— 三处口径一致，只有这里不是。
//   · 标题 `text-xl font-bold`（20/700）→ `text-base font-semibold`（16/600）：控制台那 363 张 antd Card
//     的 head title 就是 antd 的 `fontSizeLG`/600（=16/600），而页面标题是 20/600 —— 区块标题既不该与
//     页面标题同尺寸，也不该比全舰队的卡片标题更重。
// 边框仍用 `--color-border-subtle`：antd Card 走的是 antd 的 `colorBorderSecondary`（近白灰），
// 两侧不一致，已登记（要动它得改 antd 的组件令牌，是独立批次）。

interface SectionCardProps {
	title?: string;
	children: React.ReactNode;
	className?: string;
	padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
	none: '',
	sm: 'p-4',
	md: 'p-6',
	lg: 'p-8',
};

export const SectionCard = React.memo(function SectionCard({
	title,
	children,
	className = '',
	padding = 'md',
}: SectionCardProps) {
	return (
		<div
			className={`rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-sm ${paddingMap[padding]} ${className}`}
		>
			{title && (
				<h2 className="mb-4 text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
			)}
			{children}
		</div>
	);
});
