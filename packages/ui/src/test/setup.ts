import '@testing-library/jest-dom/vitest';
// jsdom 的缺口（matchMedia / ResizeObserver）只有一份实现，在 src/test-setup.ts，
// 站点也通过 @autional-cn/ui/test-setup 消费同一份。
import '../test-setup';
