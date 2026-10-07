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
//
// **页面外框也归外壳**（第 28 轮）：沟槽（p-6）+ 内容面（白色圆角面板）。
// 这条边界不是审美选择，是「同一个东西只能有一个所有者」：外框原本分散在 4 个布局文件里，
// 结果三个控制台各抄了一份逐字相同的面板、user 一份都没有，而 34 个页面又在面板里再补一层内边距
// —— 页面内缩因此在 24px 与 48px 之间随机，同一个门户的相邻两页都能不一样。

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
	className = '',
}: AppShellProps) {
	return (
		<div className={`flex h-screen bg-[var(--color-bg-muted)] ${className}`}>
			{/* 移动端遮罩：点它关闭抽屉。桌面端不渲染（lg:hidden）。 */}
			{mobileOpen && (
				<div
					className="fixed inset-0 z-40 bg-scrim/30 lg:hidden"
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

				{/* 内容面：沟槽之内那张白色圆角面板。三个控制台此前各自在自己的 App 里写了一遍
				    （逐字相同的 `min-h-[calc(100vh-112px)] rounded-lg bg-surface p-6`），user 没有 ——
				    于是四个门户的页面外框有两种：有面 / 无面，且页面还得自己再补一层内边距（实测 34 个页面这么干，
				    内缩因此从 24px 变成 48px）。外框属于外壳，搬进来之后站点侧只留内容。

				    min-height 用顶栏令牌表达：112px = 顶栏 64px + 内容区上下沟槽各 24px（p-6），
				    写成 calc 之后顶栏高度一变它跟着变 —— 写死的 112 会在顶栏改高度那天悄悄错位。 */}
				{/* 沟槽写死在外壳里：它同时是四站唯一的留白来源。放在调用方手里 = 又允许四个门户各调各的。 */}
				<main className="min-h-0 flex-1 overflow-auto p-6">
					<div className="min-h-[calc(100vh-var(--layout-header-height)-3rem)] rounded-lg bg-[var(--color-bg-surface)] p-6">
						{children}
					</div>
				</main>
			</div>
		</div>
	);
});
