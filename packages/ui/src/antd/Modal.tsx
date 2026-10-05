'use client';

import React from 'react';
import { Modal as AntModal } from 'antd';
import type { ModalProps as AntModalProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { UI_I18N_NS, uiText } from '../i18n';

// Modal —— 对话框（antd Modal 之上的薄封装）。
//
// 与 Drawer 同一条边界：DS 只固定**跨门户必须一致的部分**，其余全部透传。
//
// 这一件只固定一样：**关闭按钮的无障碍名称**。
// 按钮的 aria-label 由 rc-dialog 写死为英文 "Close"（Panel 里 `aria-label: "Close"`），
// antd 的 locale 只把它翻到关闭**图标**元素上、到不了按钮本身 —— 读屏用户听到的恒为 "Close"。
// 能压过它的只有 closable 对象里的 aria-* 属性（rc-dialog 把它们展开在写死值**之后**），
// 所以这里默认注入本地化标签；用户显式在 closable 里传了 aria-label 就以用户的为准。
//
// 文案走设计系统那套解析链（站点 i18next 注册过就优先，没有就回落内置表），与 PageStatus 同一条。

export type ModalProps = AntModalProps;

export function Modal({ closable, ...rest }: ModalProps) {
	const { t, i18n } = useTranslation();
	const closeLabel = t('modal.close', {
		ns: UI_I18N_NS,
		defaultValue: uiText(i18n.language, 'modal.close') ?? '关闭',
	});
	// closable === false 保持 false（不渲染关闭按钮）；true/undefined/对象统一并入本地化标签。
	const mergedClosable =
		closable === false
			? false
			: {
					'aria-label': closeLabel,
					...(typeof closable === 'object' && closable !== null ? closable : {}),
				};
	return <AntModal closable={mergedClosable} {...rest} />;
}
