'use client';

// FormField —— 一个字段的外壳：标签 + 控件槽 + 帮助/错误文本 + 无障碍接线。
//
// 为什么需要它：设计系统有 Input / Label 两个 atom，但**没有「一个字段」这个概念**。
// 于是每个站点自己拼：label 的 htmlFor 常常不写、错误文本的 id 与 aria-describedby 从来没接上、
// 必填标记各写各的。实测全舰队 50 处 react-hook-form 的 register( 调用点（user 10 / auth 34 / status 4 / trust 2），
// 每一处都在重新决定「标签怎么摆、错误颜色是什么、读屏器怎么念」。
//
// 它**不依赖任何表单库**：配合 react-hook-form 的 register、配合 Controller、配合自研控件都能用。
// 绑定 react-hook-form 的那一组（把 useController 也包掉）在 @autional-cn/ui/rhf 入口。

import * as React from 'react';

export interface FormFieldProps {
	/** 标签文案。不给就只渲染控件与错误/帮助文本。 */
	label?: string;
	/** 常显的帮助文本。有错误时被错误文本取代（不会同时显示两行）。 */
	hint?: string;
	/** 错误文案。有值即视为无效：控件会拿到 aria-invalid，读屏器会念到这条。 */
	error?: string;
	/** 必填标记。只影响外观与 `aria-required`，**不做校验** —— 校验归表单库。 */
	required?: boolean;
	/** 覆盖自动生成的控件 id。仅在同一个字段需要被外部引用时才需要。 */
	id?: string;
	className?: string;
	children: React.ReactNode;
}

interface FieldA11y {
	id: string;
	describedBy?: string;
	invalid: boolean;
}

const FieldA11yContext = React.createContext<FieldA11y | null>(null);

/** 供控件取用外壳生成的 id 与 aria 接线（@autional-cn/ui/rhf 的绑定控件已经替你接了）。 */
export function useFormFieldA11y(): FieldA11y | null {
	return React.useContext(FieldA11yContext);
}

export function FormField({
	label,
	hint,
	error,
	required = false,
	id,
	className = '',
	children,
}: FormFieldProps) {
	const autoId = React.useId();
	const fieldId = id ?? autoId;
	const errorId = fieldId + '-error';
	const hintId = fieldId + '-hint';
	const invalid = !!error;
	// 帮助文本与错误文本用同一个 aria-describedby 槽位：错误出现时它取代帮助文本，
	// 于是读屏器不会同时念两条互相矛盾的说明。
	const describedBy = invalid ? errorId : hint ? hintId : undefined;
	const a11y = React.useMemo<FieldA11y>(
		() => ({ id: fieldId, describedBy, invalid }),
		[fieldId, describedBy, invalid],
	);

	return (
		<div className={'space-y-1.5 ' + className}>
			{label && (
				<label htmlFor={fieldId} className="block text-sm font-medium text-[var(--color-text-primary)]">
					{label}
					{required && (
						<span className="ml-0.5 text-[var(--color-danger)]" aria-hidden="true">
							*
						</span>
					)}
				</label>
			)}
			<FieldA11yContext.Provider value={a11y}>{children}</FieldA11yContext.Provider>
			{invalid ? (
				<p id={errorId} role="alert" className="text-xs text-[var(--color-danger)]">
					{error}
				</p>
			) : hint ? (
				<p id={hintId} className="text-xs text-[var(--color-text-secondary)]">
					{hint}
				</p>
			) : null}
		</div>
	);
}
