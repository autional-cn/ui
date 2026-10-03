// 测试环境的 jsdom 缺口 —— **由设计系统统一补这一份**。
//
// 为什么放在这里而不是各站各写一遍：实测三个控制台各自抄了一份 matchMedia + ResizeObserver，
// 而 user 只有 matchMedia。于是 user 接入 antd 的那一天，8 个既有用例一起红在
// 「ResizeObserver is not defined」——错误信息完全指不到「这是 jsdom 的缺口」。
// 抄了四份的东西必然有一份漏掉，这是「拷贝而非依赖」的教科书案例。
//
// 用法（站点 vitest 配置的 setupFiles 里）：
//   import '@testing-library/jest-dom/vitest';
//   import '@autional-cn/ui/test-setup';
//
// 这不是「为了让测试过而 mock」：matchMedia 与 ResizeObserver 是真实浏览器里就有的 API，
// jsdom 只是没实现。不补的后果实测过：antd 组件会在 rc-component 的 useLayoutEffect 里抛错，
// 报错落在与真正原因完全无关的位置。

if (typeof window !== 'undefined' && !window.matchMedia) {
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

if (typeof globalThis !== 'undefined' && !(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

export {};
