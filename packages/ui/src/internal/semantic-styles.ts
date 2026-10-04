// 语义色的「浅底 + 深字」配对 —— **唯一一份**（第 31 轮从 StatusBadge 里提出来，Alert 与它共用）。
//
// 为什么必须成对，两个理由（第二个才是关键）：
//   ① 机制：preset 把颜色定义成裸 var(--color-danger)，没有 <alpha-value> 槽，
//      Tailwind **生成不出** .bg-danger/10 —— 类写了、产物里没有规则、静默无底色。
//   ② 设计：-soft 是**模式感知**的（light #fce4e4 / dark #490909），而且每一档都与对应的
//      -text 配过对比度（success 5.51 / warning 4.85 / danger 4.65 / info 6.70）。
//      原来的 text-success #52c41a 铺白底只有 2.27:1 —— 即便底色能出来，文字也不达 AA。
//
// neutral 顺带带上 dark: 变体：slate 不在设计系统色阶里，那条类同样生成不出来。
export const SOFT_TEXT = {
	success: 'bg-success-soft text-success-text',
	warning: 'bg-warning-soft text-warning-text',
	danger: 'bg-danger-soft text-danger-text',
	info: 'bg-info-soft text-info-text',
	neutral: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
} as const;

export type SemanticVariant = keyof typeof SOFT_TEXT;

// 边框与浅底同族：这样「着色块」的边界也有唯一来源，而不是各站自己挑 border-neutral-200 / border-amber-200。
export const SOFT_BORDER: Record<SemanticVariant, string> = {
	success: 'border-success-soft',
	warning: 'border-warning-soft',
	danger: 'border-danger-soft',
	info: 'border-info-soft',
	neutral: 'border-neutral-200 dark:border-neutral-700'
};
