'use client';

// DateRangeFilter —— 日期区间筛选器（antd RangePicker 之上的薄封装）。
//
// 它要解决的问题很小、但每个站点都在各自解决一遍：antd 的 RangePicker 收发的值是 dayjs 对象，
// 而**查询参数要的是字符串**。于是每个调用点都得记住用 onChange 的第二个参数（格式化后的字符串数组），
// 或者自己 dayjs() 一遍。实测控制台里已经有人这么写了：
//   onChange={(_, dates) => setDateRange(dates && dates[0] && dates[1] ? (dates as [string,string]) : null)}
// —— 也就是说这个约定是**既成事实**，只是没人把它固化下来。固化在这里之后：
//   · 站点不再需要 import dayjs（值进值出都是字符串）；
//   · 「空区间」只有一种表示（null），不再有 undefined / [] / ['',''] 三种写法；
//   · 显示格式与产出格式**是同一个** `format`，不会出现「显示带时间、产出只有日期」这种静默丢数据。
//
// 与 DataTable 同一条边界：DS 只固定**跨门户必须一致的部分**（值域类型、空值语义、与设计系统同源的
// 外观/locale），其余（showTime / disabledDate / className / placeholder / presets…）全部透传。

import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { RangePickerProps } from 'antd/es/date-picker';

const { RangePicker } = DatePicker;

/** 区间值：ISO 或与 `format` 一致的字符串二元组；`null` 表示未选。 */
export type DateRangeValue = [string, string] | null;

// 除 value / onChange / format 之外全部透传给 antd RangePicker。
export interface DateRangeFilterProps extends Omit<RangePickerProps, 'value' | 'onChange' | 'format'> {
	/** 当前区间。`null` / 省略表示无筛选。 */
	value?: DateRangeValue;
	/** 选中区间时回调；清空时回调 `null`（**不是**空数组或空串）。 */
	onChange?: (value: DateRangeValue) => void;
	/** 显示格式，同时也是**产出字符串的格式**（默认 `YYYY-MM-DD`）。带 showTime 时应显式给到含时间的格式。 */
	format?: string;
}

const DEFAULT_FORMAT = 'YYYY-MM-DD';

const toDayjs = (s: string | undefined): Dayjs | null => {
	const d = s ? dayjs(s) : null;
	return d && d.isValid() ? d : null;
};

export function DateRangeFilter({ value, onChange, format = DEFAULT_FORMAT, ...rest }: DateRangeFilterProps) {
	const range: [Dayjs | null, Dayjs | null] | null = value ? [toDayjs(value[0]), toDayjs(value[1])] : null;

	return (
		<RangePicker
			{...rest}
			format={format}
			value={range}
			onChange={(dates) => {
				// antd 在清空时给 null（有时是 [null, null]），统一收敛成一种空值表示。
				const start = dates?.[0];
				const end = dates?.[1];
				if (!start || !end) {
					onChange?.(null);
					return;
				}
				onChange?.([start.format(format), end.format(format)]);
			}}
		/>
	);
}
