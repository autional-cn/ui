'use client';

import React from 'react';
import { X } from 'lucide-react';

// AppShell —— 控制台/门户的**外壳**：侧栏 + 顶栏 + 内容区 + 移动端抽屉。
//
// 为什么要有它（实测，2026-10-04）：四个门户各自把同一套外壳写了一遍 ——
//   admin  Header 88 + Sidebar 609 · platform Header 50 + Sidebar 178 ·
//   security AppLayout 203 · user AppLayout 341   → 5 个文件 / 约 1470 行
// 其中**真正重复的是外壳本身**（外层 flex 框架、固定侧栏、sticky 顶栏、移动端遮罩与抽屉、
// 内容区的滚动容器），而**不重复的是内容**（导航项、品牌文案、右上角那几个控件）。
// 于是这里的边界就是这条：**外壳拥有 chrome 与行为，站点拥有内容**。
//
// 它刻意**不**依赖 antd：user 门户的 antd 入口已经是 0，让它为了一个外壳回去装 antd，
// 是拿「一致性」换「多一份依赖」—— 而三个控制台要的是「别再各写一遍框架」，
// 不是「必须用 antd 的 Layout」。所以：
//   · 外壳是原生 HTML + 设计系统令牌（深色模式由令牌自己切换，不需要 dark: 变体）；
//   · nav / headerRight 这类**内容**由站点以 ReactNode 传入 —— 控制台可以照旧塞 antd Menu 与 UserMenu。
//
// 顶栏高度走 var(--layout-header-height)：第 13 道闸门（顶栏契约）认这个令牌，
// 写死 h-16 会被它判红 —— 外壳必须满足同一份契约。

export interface AppShellProps {
	/** 侧栏顶部的品牌区。 */
	brand: React.ReactNode;
	/** 侧栏导航区。控制台传 antd Menu，user 传自定义列表 —— 外壳不关心里面是什么。 */
	nav: React.ReactNode;
	/** 品牌区下方、导航上方的附加区（如租户切换器）。 */
	sidebarExtra?: React.ReactNode;
	/** 顶栏左侧（移动端菜单按钮、折叠按钮、页面标题…）。 */
	headerLeft?: React.ReactNode;
	/** 顶栏右侧（PortalSwitcher / 语言 / 主题 / UserMenu…）。 */
	headerRight?: React.ReactNode;
	/** 内容区。 */
	children: React.ReactNode;
	/** 移动端抽屉是否打开（受控）。 */
	mobileOpen?: boolean;
	/** 请求关闭移动端抽屉（点遮罩 / 点关闭按钮都会走到这里）。 */
	onMobileClose?: () => void;
	/** 关闭按钮的无障碍标签。 */
	closeLabel?: string;
	/** 桌面端侧栏是否收起（只影响宽度：w-64 ↔ w-16）。 */
	sidebarCollapsed?: boolean;
	/** 内容区的类名。默认 p-4 lg:p-8（四个门户的内容内边距本来就一致）。 */
	contentClassName?: string;
	/** 追加类名。 */
	className?: string;
}

export const AppShell = React.memo(function AppShell({
	brand,
	nav,
	sidebarExtra,
	headerLeft,
	headerRight,
	children,
	mobileOpen = false,
	onMobileClose,
	closeLabel = 'Close menu',
	sidebarCollapsed = false,
	contentClassName = 'p-4 lg:p-8',
	className = '',
}: AppShellProps) {
	return (
		<div className={`flex h-screen bg-[var(--color-bg-muted)] ${className}`}>
			{/* 移动端遮罩：点它关闭抽屉。桌面端不渲染（lg:hidden）。 */}
			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/30 lg:hidden"
					onClick={onMobileClose}
					aria-hidden="true"
				/>
			)}

			<aside
				className={`fixed inset-y-0 left-0 z-50 flex transform flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] transition-transform duration-200 lg:static lg:translate-x-0 ${
					mobileOpen ? 'translate-x-0' : '-translate-x-full'
				} ${sidebarCollapsed ? 'w-64 lg:w-16' : 'w-64'}`}
			>
				<div className="flex h-[var(--layout-header-height)] shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4">
					<div className="flex min-w-0 items-center gap-2">{brand}</div>
					<button
						type="button"
						className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] lg:hidden"
						onClick={onMobileClose}
						aria-label={closeLabel}
					>
						<X size={20} />
					</button>
				</div>

				{sidebarExtra}

				<nav className="flex min-h-0 flex-1 flex-col overflow-y-auto">{nav}</nav>
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="sticky top-0 z-10 flex h-[var(--layout-header-height)] shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 lg:px-8">
					<div className="flex min-w-0 items-center gap-4">{headerLeft}</div>
					<div className="flex shrink-0 items-center gap-3">{headerRight}</div>
				</header>

				<main className={`min-h-0 flex-1 overflow-auto ${contentClassName}`}>{children}</main>
			</div>
		</div>
	);
});
