import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { MultiSelect, Select } from '../select-legacy';

const options = [
  { value: 'first', label: '第一项' },
  { value: 'second', label: '第二项' },
  { value: 'third', label: '第三项' },
];

function SelectHarness() {
  const [value, setValue] = useState<string | null>(null);
  return <Select options={options} value={value} onChange={setValue} placeholder="请选择" />;
}

function MultiSelectHarness() {
  const [value, setValue] = useState<string[]>([]);
  return <MultiSelect options={options} value={value} onChange={setValue} placeholder="请选择" />;
}

describe('select-legacy keyboard navigation', () => {
  it('单选下拉支持方向键高亮并回车选中', () => {
    render(<SelectHarness />);

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(trigger.textContent).toContain('第二项');
  });

  it('多选下拉支持方向键高亮并回车切换选中', () => {
    render(<MultiSelectHarness />);

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(trigger.textContent).toContain('第二项');
  });
});
