'use client';

// 控制台的整页占位：加载中 / 加载失败（可重试）。
//
// 为什么把它收进设计系统：admin 与 platform 此前**各有一份**
// src/components/ui/page-status.tsx，内容逐字相同（同一个居中 Spin、同一个
// Empty.PRESENTED_IMAGE_SIMPLE、同一个重试按钮），唯一差别是 admin 走 react-i18next、
// platform 把中文写死在组件里 —— 于是同一件事有了两份实现，而且其中一份永远只能是中文。
// 实测用量：admin 70 个文件 import 它 / <PageError> 96 处；platform 13 个文件 /
// <PageError> 43 处 + <PageLoading> 13 处。抄成两份的东西必然有一份先坏，这里留唯一一份。
//
// 文案走设计系统那套解析链（站点 i18next 注册过就优先，没有就回落内置表），与 PortalSwitcher 同一条。
// 重试图标用 lucide 而不是 @ant-design/icons：设计系统已有的组件（ErrorState）就是 lucide，
// 而 antd 的图标包是本包**没有**声明的依赖 —— 为了一个重试图标去给所有人加一条 peer 不划算。

import { Button, Empty, Spin } from 'antd';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UI_I18N_NS, uiText } from '../i18n';

export interface PageLoadingProps {
	/** 覆盖默认的「加载中…」。 */
	tip?: string;
	className?: string;
}

export interface PageErrorProps {
	/** 覆盖默认的「数据加载失败」。 */
	message?: string;
	retry?: () => void;
	className?: string;
}

function useStatusText() {
	const { t, i18n } = useTranslation();
	return (key: string, lastResort: string): string => {
		const builtin = uiText(i18n.language, key);
		return t(key, { ns: UI_I18N_NS, defaultValue: builtin ?? lastResort });
	};
}

/** 整页加载占位（居中 Spin）。 */
export function PageLoading({ tip, className = '' }: PageLoadingProps) {
	const text = useStatusText();
	return (
		<div className={`flex h-64 items-center justify-center ${className}`}>
			<Spin size="large" tip={tip ?? text('pageStatus.loading', '加载中…')} />
		</div>
	);
}

/** 整页错误占位（带重试按钮）。 */
export function PageError({ message, retry, className = '' }: PageErrorProps) {
	const text = useStatusText();
	return (
		<div className={`flex h-64 flex-col items-center justify-center gap-4 ${className}`}>
			<Empty
				description={message ?? text('pageStatus.loadError', '数据加载失败')}
				image={Empty.PRESENTED_IMAGE_SIMPLE}
			/>
			{retry && (
				<Button icon={<RefreshCw className="h-4 w-4" />} onClick={retry}>
					{text('pageStatus.retry', '重试')}
				</Button>
			)}
		</div>
	);
}
