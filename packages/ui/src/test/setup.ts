import '@testing-library/jest-dom/vitest';

// antd 依赖 matchMedia 与 ResizeObserver，而 jsdom **两个都不实现**。
// 这里补上不是「为了让测试过而 mock」，而是补 jsdom 的缺口 —— 真实浏览器里没有这个问题。
// 不补的后果实测过：DataTable 的 3 个用例全部失败，报错落在 rc-component 的 useLayoutEffect 上，
// 信息完全指不到「缺 matchMedia」这个真正原因。
if (!window.matchMedia) {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
}

if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
