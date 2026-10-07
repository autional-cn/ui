import * as React from 'react';
import { fieldControlClass, fieldControlHeight } from '../internal/field-styles';

// 注：`prefix` 与 HTML 自带的 `prefix` 属性同名（后者在 <input> 上没有意义，TS 会报
// 「ReactNode 不能赋给 string」）。所以这里显式 Omit 掉它再重定义 —— 保住最自然的调用名。
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
	error?: string;
	/**
	 * 前缀槽：图标或极短的单位符号（如货币符号）。
	 *
	 * 为什么要有它（第 59 轮）：舰队里 5 个站在手写同一个模式 ——
	 * 一个 `relative` 容器 + 绝对定位的图标 + **算出来的**左内边距（`pl-9` = 12 起点 + 16 图标 + 8 间隙 = 36px）。
	 * 那是同一个几何被抄了 6 遍，而且抄出来的值不在档位上。
	 * 这里用 **flex 排布**而不是绝对定位：图标占真实布局空间，于是
	 * **不需要任何魔法内边距**，也不挑图标尺寸。
	 *
	 * 图标请守图标纪律：默认 `size="1em"`，显式字号时 `size={N}`。
	 */
	prefix?: React.ReactNode;
	/** 后缀槽：清除按钮、单位后缀一类。同样占真实布局空间。 */
	suffix?: React.ReactNode;
}

// 外观来自 ../internal/field-styles —— 与 @autional/ui/rhf 的绑定控件同一份，不各自维护。
//
// 两种渲染形态（**无槽时逐字节不变**，既有消费方零影响）：
//   · 无 prefix/suffix：只有一个 <input>，外框在它自己身上（原样）；
//   · 有槽：外框交给 wrapper，<input> 变透明并占满剩余宽度 —— 高度/圆角由调用方
//     原有的 className 决定（舰队里搜索框有三种几何：py-2 / py-2.5 / py-3.5 rounded-full），
//     所以这一层**不替调用方决定尺寸**。
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className = '', error, prefix, suffix, ...props }, ref) => {
		const hasSlot = prefix != null || suffix != null;
		return (
			<div className="w-full">
				{hasSlot ? (
					<div className={fieldControlClass(!!error, 'flex items-center gap-2 ' + className)}>
						{prefix != null && (
							<span className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true">{prefix}</span>
						)}
						<input ref={ref} className="min-w-0 flex-1 bg-transparent p-0 text-inherit outline-none placeholder:text-[var(--color-text-muted)]" {...props} />
						{suffix != null && <span className="shrink-0">{suffix}</span>}
					</div>
				) : (
					<input ref={ref} className={fieldControlClass(!!error, fieldControlHeight + ' ' + className)} {...props} />
				)}
				{error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
			</div>
		);
	},
);
Input.displayName = 'Input';
