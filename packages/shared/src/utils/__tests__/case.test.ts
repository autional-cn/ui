import { describe, it, expect } from 'vitest';
import { snakeCaseKeys, camelCaseKeys } from '../case';

// U385 回归锁（AC-AUTH-39/U385）：snakeCaseKeys 必须 acronym-aware。
// 此前朴素正则（每个大写字母前插 `_`）把 WebAuthn 请求体的 camel 键 mangling：
//   clientDataJSON → client_data_j_s_o_n（服务端期望 client_data_json，go-webauthn 校验恒败）
// 真实受害链：passkey begin/complete 请求经 apiClient 拦截器后键名错位 → 400/校验失败。
describe('snakeCaseKeys acronym-aware（U385）', () => {
	it('WebAuthn camel 键族 → 正确 snake（旧实现 mangling 的键）', () => {
		expect(
			snakeCaseKeys({
				clientDataJSON: 'cdj',
				attestationObject: 'ao',
				rawId: 'rid',
				userHandle: 'uh',
				transports: ['usb'],
			}),
		).toEqual({
			client_data_json: 'cdj',
			attestation_object: 'ao',
			raw_id: 'rid',
			user_handle: 'uh',
			transports: ['usb'],
		});
	});

	it('尾部缩写：userID → user_id、testID → test_id（旧实现 user_i_d/test_i_d）', () => {
		expect(snakeCaseKeys({ userID: 'u', testID: 't' })).toEqual({ user_id: 'u', test_id: 't' });
	});

	it('前导缩写：URLValue → url_value、APIVersion → api_version、HTMLParser → html_parser', () => {
		expect(
			snakeCaseKeys({ URLValue: 'v', APIVersion: 'v1', HTMLParser: true }),
		).toEqual({ url_value: 'v', api_version: 'v1', html_parser: true });
	});

	it('数字边界：sha256Value → sha256_value、base64URL → base64_url', () => {
		expect(snakeCaseKeys({ sha256Value: 'v', base64URL: 'b' })).toEqual({
			sha256_value: 'v',
			base64_url: 'b',
		});
	});

	it('常规 camel 不回归：pageSize/currentPage（contract G1 同口径）', () => {
		expect(snakeCaseKeys({ pageSize: 20, currentPage: 2 })).toEqual({
			page_size: 20,
			current_page: 2,
		});
	});

	it('已是 snake 的字面量键原样保留（含下划线/全小写）', () => {
		expect(snakeCaseKeys({ client_data_json: 'v', plain: 1 })).toEqual({
			client_data_json: 'v',
			plain: 1,
		});
	});

	it('深递归：嵌套对象/数组同样走 acronym-aware 转换', () => {
		expect(snakeCaseKeys({ webAuthn: { clientDataJSON: 'x', list: [{ rawID: 'r' }] } })).toEqual({
			web_authn: { client_data_json: 'x', list: [{ raw_id: 'r' }] },
		});
	});
});

// U407 wire 约定锁定：数字贴词尾（`_<数字>` 形态对 lodash camel 折叠不可逆，wire 禁止使用）。
// 原 wire 键 live_stream_blocked_under_16 与 under16 在响应方向折叠为同名 liveStreamBlockedUnder16
// ⇒ 请求方向无法还原下划线位置（line1/under_16 同形歧义）。平台侧已把该字段归一为
// live_stream_blocked_under16（service-tenant U407），本锁固定双向往返无损 + 反例（下划线-数字形态不可逆）。
describe('snakeCaseKeys ↔ camelCaseKeys 往返（U407 wire 键约定：数字贴词）', () => {
	it('live_stream_blocked_under16 双向无损（平台 minors 字段现行 wire 形态）', () => {
		expect(snakeCaseKeys({ liveStreamBlockedUnder16: true })).toEqual({
			live_stream_blocked_under16: true,
		});
		expect(camelCaseKeys({ live_stream_blocked_under16: true })).toEqual({
			liveStreamBlockedUnder16: true,
		});
	});

	it('反例说明：下划线-数字形态（under_16）不可由 camel 还原——故 wire 禁用该形态', () => {
		// camelCaseKeys 折叠后与 under16 同名；snakeCaseKeys 只能还原出 under16，不可能知道下划线位置。
		expect(camelCaseKeys({ under_16: true })).toEqual({ under16: true });
		expect(snakeCaseKeys({ under16: true })).toEqual({ under16: true });
	});
});

// camelCaseKeys 回归边界：lodash camelCase 对缩写的行为（响应方向契约，保持现状即可）
describe('camelCaseKeys 响应方向（现状锁定）', () => {
	it('snake → camel；缩写键由 lodash 归一为小写驼峰（client_data_json → clientDataJson）', () => {
		expect(camelCaseKeys({ client_data_json: 'v', page_size: 10 })).toEqual({
			clientDataJson: 'v',
			pageSize: 10,
		});
	});
});
