'use client';

import React from 'react';

// AppPageHeader —— **应用外壳里的页面页头**：左对齐标题 + 右侧操作槽 + 可选副标题。
//
// 为什么不是 DS 里已有的 PageHeader：那是**营销 hero**（text-center + text-3xl/sm:text-4xl），
// 落地页在用；应用页头是另一种东西（左对齐 + text-xl/font-semibold + 右侧操作槽）。
// 两者**同名不同物**，互相替换会把控制台的密度打散 —— 所以这里另立一件，PageHeader 保持原样（D5）。
//
// 第 63 轮改名（L17）：原名 ConsolePageHeader 把契约说小了 —— user 门户（面向终端用户，
// 不是「控制台」）早就是它的大用户。实测改名当时 **393 处**调用（站点 359 + 设计系统 34），
// 而 L17 登记的是 174 处：**台账里的数字也会腐**，动手前必须重数。
// 新名字跟着 AppShell 走：外壳叫什么，外壳里的页头就叫什么，与页面是不是「控制台」无关。
// 不保留旧名别名 —— 全舰队同一批迁完，留一个只被我们自己引用的旧名字只会变成死代码。
//
// 收敛前实测（2026-10）：三个控制台在 **106 个页面**里把这段页头内联写了 106 遍，
// 包裹容器的 className 有 **11 种**（mb-4 / mb-6、有没有 justify-between、有没有响应式断点各不相同）。
// 这里固定成一种：窄屏纵向堆叠、sm 起横向两端对齐、gap-3、下边距 mb-6 —— 与其中 55 处的多数派一致。

export interface AppPageHeaderProps {
	/** 页面标题。 */
	title: React.ReactNode;
	/** 标题下方的说明文字（可选）。 */
	description?: React.ReactNode;
	/** 右侧操作区（查询 / 导出 / 新建…）。窄屏时落到标题下方。 */
	actions?: React.ReactNode;
	/** 追加类名。用于个别页面的例外情况；**间距由组件自己定**，不通过这个口子改。 */
	className?: string;
}

export const AppPageHeader = React.memo(function AppPageHeader({
	title,
	description,
	actions,
	className = '',
}: AppPageHeaderProps) {
	return (
		<div
			className={`mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
		>
			<div className="min-w-0">
				<h1 className="text-xl font-semibold">{title}</h1>
				{description ? (
					<div className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</div>
				) : null}
			</div>
			{actions ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div> : null}
		</div>
	);
});
