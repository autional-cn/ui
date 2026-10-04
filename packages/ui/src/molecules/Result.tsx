'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { SOFT_BORDER, SOFT_TEXT, type SemanticVariant } from '../internal/semantic-styles';

// Result —— 「结果块」：一个动作做完之后告诉用户结果（成功/失败/无权/找不到），
// 居中的图标 + 标题 + 说明 + 一个动作。
//
// 为什么要有它（第 32 轮实测）：这类块在舰队里有两套互不相干的实现 ——
//   · 控制台 9 处用 antd 的 `<Result>`（404 / 403 / not-found / 无权限页 / 校验结果）；
//   · user 门户 6 处手写：**两种形态**（`bg-*-soft` 的整块浅底 / 白底 + 同色边框 + 圆形徽标），
//     外加一页 404 手写 hero。四种门户的「结果」长得各不相同。
//
// 与 Alert 的分工：Alert 是**一行提示**（挂在页面里，左对齐、窄、可关闭）；
// Result 是**一个区块的结果**（居中、图标大、带一个动作）。两者共用同一份 `SOFT_TEXT`/`SOFT_BORDER` 配对。
//
// 刻意不做 `status` 这样的「大字状态位」：404 那种大字直接写在 `title` 里就行（`title` 是 ReactNode），
// 一个只为了 5 个待迁移页面而存在的属性不该先长出来。
export type ResultSurface = 'plain' | 'tinted';

export interface ResultProps {
	/** 语义档位，默认 info。 */
	variant?: SemanticVariant;
	/** 底色：`plain` = 白色面 + 同色边框（默认）；`tinted` = 整块同色浅底。 */
	surface?: ResultSurface;
	/** 标题（可以是节点 —— 404 那种大字就写在标题里）。 */
	title?: React.ReactNode;
	/** 说明文字。 */
	description?: React.ReactNode;
	/** 图标：默认按档位给一个；显式传 `null` 可以不要图标。 */
	icon?: React.ReactNode | null;
	/** 底部动作（一个或一组按钮）。 */
	action?: React.ReactNode;
	/** 追加类名。 */
	className?: string;
}

const DEFAULT_ICONS: Record<SemanticVariant, React.ReactNode> = {
	success: <CheckCircle2 className="h-7 w-7" />,
	warning: <AlertTriangle className="h-7 w-7" />,
	danger: <XCircle className="h-7 w-7" />,
	info: <Info className="h-7 w-7" />,
	neutral: <Info className="h-7 w-7" />
};

// 只取配对里的「文字那一半」：`bg-X-soft text-X-text` → `text-X-text`。
// 直接写 `text-danger` 是错的（danger 对白底 2.27:1），而配对那一份已经过对比度验证。
const textTone = (v: SemanticVariant) => SOFT_TEXT[v].split(' ').filter((c) => c.startsWith('text-')).join(' ');

export const Result = React.memo(function Result({
	variant = 'info',
	surface = 'plain',
	title,
	description,
	icon,
	action,
	className = ''
}: ResultProps) {
	const tinted = surface === 'tinted';
	const glyph = icon === null ? null : (icon ?? DEFAULT_ICONS[variant]);
	const surfaceCls = tinted
		? `${SOFT_TEXT[variant]} ${SOFT_BORDER[variant]}`
		: `bg-[var(--color-bg-surface)] ${SOFT_BORDER[variant]}`;
	// 徽标：白底卡片上用同色浅底，整块浅底上退回白色面 —— 两种都保证徽标里的图标仍压在同色浅底上。
	const badgeCls = tinted ? 'bg-[var(--color-bg-surface)]' : SOFT_TEXT[variant];
	return (
		<div className={`flex flex-col items-center rounded-lg border p-8 text-center shadow-sm ${surfaceCls} ${className}`}>
			{glyph ? (
				<span className={`flex h-16 w-16 items-center justify-center rounded-full ${badgeCls} ${tinted ? textTone(variant) : ''}`}>
					{glyph}
				</span>
			) : null}
			{title ? (
				<h2 className={`mt-4 text-lg font-semibold ${tinted ? '' : 'text-[var(--color-text-primary)]'}`}>{title}</h2>
			) : null}
			{description ? <p className={`mt-2 text-sm ${tinted ? '' : textTone(variant)}`}>{description}</p> : null}
			{action ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}</div> : null}
		</div>
	);
});
