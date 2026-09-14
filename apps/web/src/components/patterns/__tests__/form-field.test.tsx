import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormField, FormModeProvider, useFormMode } from '../form-field';

function ModeProbe() {
  const { mode } = useFormMode();
  return <span>mode:{mode}</span>;
}

describe('FormField', () => {
  it('view 模式显示 viewContent 且不显示必填星号', () => {
    render(
      <FormModeProvider mode="view">
        <FormField name="name" label="名称" required viewContent="示例" />
      </FormModeProvider>
    );

    expect(screen.getByText('名称').textContent).toBe('名称');
    expect(screen.getByText('示例')).not.toBeNull();
  });

  it('view 模式保留多行文本中的换行', () => {
    render(
      <FormModeProvider mode="view">
        <FormField name="remark" label="备注" viewContent={'第一行\n第二行'} />
      </FormModeProvider>
    );

    expect(screen.getByText(/第一行/).className).toContain('whitespace-pre-wrap');
    expect(screen.getByText(/第一行/).textContent).toBe('第一行\n第二行');
  });

  it('edit 模式显示控件、帮助文本和错误文本优先级', () => {
    const { rerender } = render(
      <FormModeProvider mode="edit">
        <FormField name="name" label="名称" required helpText="请输入名称">
          <input id="name" />
        </FormField>
      </FormModeProvider>
    );

    expect(screen.getByText('*')).not.toBeNull();
    expect(screen.getByText('请输入名称')).not.toBeNull();
    expect(screen.getByLabelText(/名称/).getAttribute('aria-describedby')).toBe('name-help');

    rerender(
      <FormModeProvider mode="edit">
        <FormField name="name" label="名称" required helpText="请输入名称" error="名称必填">
          <input id="name" />
        </FormField>
      </FormModeProvider>
    );

    expect(screen.getByRole('alert').textContent).toBe('名称必填');
    expect(screen.getByLabelText(/名称/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/名称/).getAttribute('aria-describedby')).toBe('name-error');
    expect(screen.queryByText('请输入名称')).toBeNull();
  });

  it('FormModeProvider 向子组件提供当前模式', () => {
    render(
      <FormModeProvider mode="create">
        <ModeProbe />
      </FormModeProvider>
    );

    expect(screen.getByText('mode:create')).not.toBeNull();
  });

  it('label 尊重子控件显式 id', () => {
    render(
      <FormModeProvider mode="edit">
        <FormField name="name" label="名称">
          <input id="explicit-name-control" />
        </FormField>
      </FormModeProvider>
    );

    expect(screen.getByText('名称').getAttribute('for')).toBe('explicit-name-control');
    expect(screen.getByLabelText('名称').id).toBe('explicit-name-control');
  });

  it('复合控件的 id 和错误 ARIA 落在可聚焦 trigger', () => {
    function CompositeSelect(props: Record<string, unknown>) {
      return (
        <div {...props}>
          <button type="button">选择部门</button>
        </div>
      );
    }

    const { rerender } = render(
      <FormModeProvider mode="edit">
        <FormField name="departmentId" label="部门" error="请选择部门">
          <CompositeSelect />
        </FormField>
      </FormModeProvider>
    );

    const trigger = screen.getByRole('button', { name: '部门' });
    expect(trigger.id).toBe('departmentId');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('departmentId-error');
    expect(screen.getByLabelText('部门')).toBe(trigger);

    rerender(
      <FormModeProvider mode="edit">
        <FormField name="departmentId" label="部门">
          <CompositeSelect />
        </FormField>
      </FormModeProvider>
    );

    expect(screen.getByRole('button', { name: '部门' }).hasAttribute('aria-describedby')).toBe(
      false
    );
  });
});
