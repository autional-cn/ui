'use client';

import React from 'react';
import { Drawer as AntDrawer } from 'antd';
import type { DrawerProps as AntDrawerProps } from 'antd';

// Drawer —— 详情/编辑抽屉（antd Drawer 之上的薄封装）。
//
// 与 DataTable 同一条边界：DS 只固定**跨门户必须一致的部分**，其余全部透传。
//
// 实测（2026-10-04，21 处直接使用 antd Drawer）暴露的是**词汇**问题，不是外观问题：
//   admin     size={600} / size="large" / size={500} / size={560} / size={720}
//   platform  （不写尺寸，落到 antd 默认）
//   security  width={600} / width={560} / width={700} / width={520} / placement="right" / destroyOnClose
// 也就是说：同一个东西有**两个属性名**（antd 6 把 width 收成了 size，security 还停在旧名），
// 尺寸是**八个各写各的数字**，destroyOnClose 在 antd 6.5 里已标 @deprecated（新名 destroyOnHidden）——
// 那是「改了一半的迁移」留在源码里的样子。
//
// 所以这一件固定三样：
//   ① **尺寸词汇**：sm/md/lg/xl 四档（480 / 560 / 720 / 960），不再接受任意数字；
//   ② **placement 恒为 right**：本舰队的抽屉都是「右侧详情」，把方向也收进契约；
//   ③ **不再暴露 width 与 destroyOnClose**：前者是旧名，后者是废弃名（类型上直接 Omit 掉，
//      写错就编译不过 —— 比在文档里写「请用新名字」有效）。
//
// 尺寸阶梯是按现有取值就近归的，不是拍脑袋：
//   500/520 → sm(480) · 560/600 → md(560) · 700/720/antd-large(736) → lg(720)
export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<DrawerSize, number> = { sm: 480, md: 560, lg: 720, xl: 960 };

export interface DrawerProps
	extends Omit<AntDrawerProps, 'size' | 'width' | 'destroyOnClose' | 'placement'> {
	/** 尺寸档位，默认 md(560px)。 */
	size?: DrawerSize;
}

export function Drawer({ size = 'md', ...rest }: DrawerProps) {
	return <AntDrawer {...rest} placement="right" size={SIZES[size]} />;
}
