import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table } from 'antd';
import { DataTable } from '../DataTable';

const columns = [{ title: 'Name', dataIndex: 'name', key: 'name' }];
const data = [{ key: '1', name: 'alpha' }, { key: '2', name: 'beta' }];

describe('DataTable（薄透传契约）', () => {
	it('透传 columns / dataSource，并把单元格渲染出来', () => {
		render(<DataTable columns={columns} dataSource={data} pagination={false} />);
		expect(screen.getByText('Name')).toBeTruthy();
		expect(screen.getByText('alpha')).toBeTruthy();
		expect(screen.getByText('beta')).toBeTruthy();
	});

	it('透传 rowKey / onRow 这类行为 props（不在 DS 的管辖范围）', () => {
		let rowKeySeen = 0;
		render(
			<DataTable
				columns={columns}
				dataSource={data}
				pagination={false}
				rowKey={(r) => { rowKeySeen++; return String(r.key); }}
			/>,
		);
		expect(rowKeySeen).toBeGreaterThan(0);
	});

	it('pagination 为 false 时不渲染分页', () => {
		const { container } = render(<DataTable columns={columns} dataSource={data} pagination={false} />);
		expect(container.querySelector('.ant-pagination')).toBeNull();
	});

	it('复合成员与 antd Table 是**同一批**引用（透传而不是重造）', () => {
		// 负向控制：如果这里改成自己重造的组件，引用就不相等 —— 那正是「两个入口」的开始。
		expect(DataTable.Summary).toBe(Table.Summary);
		expect(DataTable.Column).toBe(Table.Column);
		expect(DataTable.ColumnGroup).toBe(Table.ColumnGroup);
		expect(DataTable.SELECTION_ALL).toBe(Table.SELECTION_ALL);
		expect(DataTable.SELECTION_NONE).toBe(Table.SELECTION_NONE);
		expect(DataTable.EXPAND_COLUMN).toBe(Table.EXPAND_COLUMN);
	});

	it('汇总行可通过 DataTable.Summary 渲染出来（user 发票明细表用的就是它）', () => {
		const { container } = render(
			<DataTable
				columns={columns}
				dataSource={data}
				pagination={false}
				summary={() => (
					<DataTable.Summary.Row>
						<DataTable.Summary.Cell index={0}>合计</DataTable.Summary.Cell>
						<DataTable.Summary.Cell index={1}>2</DataTable.Summary.Cell>
					</DataTable.Summary.Row>
				)}
			/>,
		);
		expect(screen.getByText('合计')).toBeTruthy();
		expect(container.querySelector('.ant-table-summary')).toBeTruthy();
	});
});
