'use client';

// @autional/ui/rhf 的绑定控件：把 react-hook-form 的 useController 也包掉，
// 于是调用点只剩「字段名 + 标签 + 输入属性」，标签/错误/aria 接线一律由设计系统给。
//
// 为什么值得包：整个舰队有 50 处 react-hook-form 的 register( 调用点（user 10 / auth 34 / status 4 / trust 2），
// 每一处都在自己决定标签怎么写、错误显示成什么样、读屏器能不能念到那条错误。
//
// 为什么是**可选** peer：绑定控件在 ./rhf 子路径入口，不进默认入口 ——
// 不吃 react-hook-form 的站点（5 个 Astro 站、营销站）不会因为它多装一个包。

import * as React from 'react';
import { useController } from 'react-hook-form';
import type { Control, FieldValues, Path, UseControllerProps } from 'react-hook-form';
import { useFormFieldA11y } from '../molecules/FormField';

/** 绑定控件共有的 props。泛型 T 是表单值的类型，name 因此能校验到真实字段。 */
export interface FormControlBaseProps<T extends FieldValues> {
	name: Path<T>;
	/** 表单控制对象。给了就用它，不给则从最近的 FormProvider 上下文取。 */
	control?: Control<T>;
	label?: string;
	hint?: string;
	required?: boolean;
	/**
	 * 字段级校验规则（透传给 react-hook-form）。
	 *
	 * 站点的 schema 校验走 zodResolver，用不到它；但**没有它，需要单字段规则的地方就只能退回 register()** ——
	 * 那正是这个入口想消灭的写法。所以照 RHF 的原义透传，而不是自创一套。
	 */
	rules?: UseControllerProps<T>['rules'];
	/**
	 * 覆盖错误文案。不给就用表单库给的那条。
	 *
	 * 为什么需要这个口子：本项目的 zod message 是 **i18n 键**（如 `mustMatch`），不是给人看的文案，
	 * 而页面今天按字段给的是自己的键（如 `security.deleteAccount.passwordRequired`）。
	 * 没有覆盖口子，接入绑定控件就会**悄悄换掉用户看到的报错文案** —— 那是收敛不该付的代价。
	 * 校验仍然归表单库，这里只决定「显示哪句话」。
	 */
	error?: string;
	className?: string;
}

/** 把 FormField 生成的 id / aria-invalid / aria-describedby 接到真实控件上。 */
export function ControlSlot({
	render,
}: {
	render: (a11y: { id: string; invalid: boolean; describedBy?: string }) => React.ReactNode;
}) {
	const a11y = useFormFieldA11y();
	// FormField 一定会提供上下文；这里的兜底只为类型收敛，不改变行为。
	return <>{render(a11y ?? { id: '', invalid: false, describedBy: undefined })}</>;
}

export function useBoundField<T extends FieldValues>(
	name: Path<T>,
	control: Control<T> | undefined,
	rules: UseControllerProps<T>['rules'],
	override?: string,
) {
	const { field, fieldState } = useController({ name, control, rules });
	return { field, error: override ?? fieldState.error?.message };
}
