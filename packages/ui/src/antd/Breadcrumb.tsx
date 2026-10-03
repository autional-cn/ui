'use client';

// Breadcrumb —— 三个门户各写了一遍的「把 URL 变成面包屑」。
//
// 逐行比对（2026-10-03）：admin 145 行（antd + 78 条路由映射 + 按段累积 + 中间段可点 + 详情页启发式），
// platform 54 行（antd + 27 条映射 + 按段累积，但**中间段不可点**），
// user 77 行（**手写 nav + lucide 图标**，且**只认完整路径**、不按段累积、上限两项）。
// 三份的**业务部分**（路由→文案的映射表）内容完全不同，必须留在站点；
// 而**机制部分**三份各写一遍、还写出了三种行为：
//   剥租户段（admin 用 stripTenantPrefix / platform 手写 slice / user 正则 replace）、
//   按段累积 currentPath、中间段可点、末段纯文本、「只有一项就不渲染」。
// 这个组件收的就是机制，映射表通过 labels 传进来。
//
// 为什么渲染用 antd 的 Breadcrumb：三个门户里两个已经在用它（admin / platform），
// 而 user 那 77 行是手写的 —— 收敛的方向应该是「少数向多数靠」，而不是反过来。
// 顺带把 user 的「只认完整路径」也统一成按段累积：路径里若有一段在映射表里，
// 它会多显示一级（并成为可点的链接），这正是 admin / platform 早就有的行为。

import { Breadcrumb as AntBreadcrumb } from 'antd';
import { Link } from 'react-router';

export interface BreadcrumbProps {
	/** 完整 pathname（含租户段）。剥段在本组件里做 —— 三个站点此前各写了一遍。 */
	pathname: string;
	/** 当前租户 slug。给了就剥掉首段，没给按原样处理。 */
	tenantSlug?: string | null;
	/** 路由段 → 文案。键是**累积路径**（如 '/wallet/withdrawals'）。这段内容各站不同，留在站点。 */
	labels: Record<string, string>;
	/** 首页项。不给则不渲染首页项（只渲染映射表命中的段）。 */
	home?: { label: string; href: string };
	/** 认不出、但形态像 ID 的段（长度 > 8 的字母数字串）显示成什么。不给则原样显示该段。 */
	detailLabel?: string;
	/** 站点的链接构造（各站带租户前缀的方式不同，如 admin 走 buildNavHref）。默认原样返回。 */
	buildHref?: (path: string) => string;
	className?: string;
}

/** 剥租户段：`/acme/users` + slug `acme` → `/users`。 */
export function stripTenantSegment(pathname: string, tenantSlug?: string | null): string {
	if (!tenantSlug) return pathname || '/';
	const prefix = '/' + tenantSlug;
	if (pathname === prefix) return '/';
	return pathname.startsWith(prefix + '/') ? pathname.slice(prefix.length) : pathname;
}

export interface BreadcrumbTrailItem {
	label: string;
	/** 有 href 的是可点的中间段；末段没有 href。 */
	href?: string;
}

/**
 * 纯函数：把站内相对路径变成面包屑的「轨迹」。抽出来是因为它才是三份实现真正重复的部分，
 * 而且是唯一能**脱离 React 单测**的部分（渲染那层用 antd，测试价值低）。
 */
export function buildBreadcrumbTrail({
	path,
	labels,
	home,
	detailLabel,
	buildHref = (p) => p,
}: {
	path: string;
	labels: Record<string, string>;
	home?: { label: string; href: string };
	detailLabel?: string;
	/** 站点的链接构造（各站带租户前缀的方式不同）。默认原样返回。 */
	buildHref?: (path: string) => string;
}): BreadcrumbTrailItem[] {
	const trail: BreadcrumbTrailItem[] = [];
	if (home && path !== '/') trail.push({ label: home.label, href: home.href });

	const parts = path.split('/').filter(Boolean);
	let current = '';
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		current += '/' + part;
		const isLast = i === parts.length - 1;
		const known = labels[current];
		if (known) {
			trail.push({ label: known, href: isLast ? undefined : buildHref(current) });
			continue;
		}
		// 未命中映射表：像 ID 的段显示成 detailLabel（admin 早就有的启发式），
		// 其余原样显示 —— **不静默丢掉一段**，否则面包屑会与实际位置不符（platform 之前就是丢掉）。
		const looksLikeId = /^[a-zA-Z0-9_-]+$/.test(part) && part.length > 8;
		const label = looksLikeId && detailLabel ? detailLabel : part;
		trail.push({ label, href: isLast ? undefined : buildHref(current) });
	}
	return trail;
}

export function Breadcrumb({
	pathname,
	tenantSlug,
	labels,
	home,
	detailLabel,
	buildHref,
	className = 'mb-4',
}: BreadcrumbProps) {
	const path = stripTenantSegment(pathname, tenantSlug);
	if (path === '/') return null;

	const trail = buildBreadcrumbTrail({ path, labels, home, detailLabel, buildHref });
	// 只有一项（例如首页项）时不渲染 —— 三个门户原本都有这条规则，保留它。
	if (trail.length <= 1) return null;

	return (
		<AntBreadcrumb
			className={className}
			items={trail.map((item, i) => ({
				title: item.href ? <Link to={item.href}>{item.label}</Link> : item.label,
				key: (item.href ?? '') + i,
			}))}
		/>
	);
}
