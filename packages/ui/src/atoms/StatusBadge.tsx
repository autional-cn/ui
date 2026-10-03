import React from 'react';

export type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusBadgeProps {
	variant?: StatusVariant;
	children: React.ReactNode;
	className?: string;
}

const variantStyles: Record<StatusVariant, string> = {
	// 浅底一律用 -soft，正文一律用对应的 -text —— 这是 $soft-note 规定的**完整配对**。
	// 两个理由，第二个才是关键：
	//   ① 机制：preset 把颜色定义成裸 var(--color-danger)，没有 <alpha-value> 槽，
	//      Tailwind **生成不出** .bg-danger\/10 —— 类写了、产物里没有规则、静默无底色。
	//   ② 设计：-soft 是**模式感知**的（light #fce4e4 / dark #490909），而且每一档都与
	//      对应的 -text 配对做过对比度验证（success 5.51 / warning 4.85 / danger 4.65 / info 6.70）。
	//      原来的 text-success #52c41a 铺白底只有 2.27:1 —— 即便底色能出来，文字也不达 AA。
	// neutral 顺带去掉 dark:bg-slate-800：slate 不在设计系统色阶里，那条类同样生成不出来。
	success: 'bg-success-soft text-success-text',
	warning: 'bg-warning-soft text-warning-text',
	danger: 'bg-danger-soft text-danger-text',
	info: 'bg-info-soft text-info-text',
	neutral: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

export const StatusBadge = React.memo(function StatusBadge({
	variant = 'neutral',
	children,
	className = '',
}: StatusBadgeProps) {
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${variantStyles[variant]} ${className}`}
		>
			{children}
		</span>
	);
});
