import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeadsBoard } from '../LeadsBoard';

const dndMocks = vi.hoisted(() => {
  const PointerSensor = function PointerSensor() {};
  const KeyboardSensor = function KeyboardSensor() {};
  const sortableKeyboardCoordinates = vi.fn();
  return {
    PointerSensor,
    KeyboardSensor,
    sortableKeyboardCoordinates,
    dragPointerDown: vi.fn(),
    useSensor: vi.fn((sensor: unknown, options?: unknown) => ({ sensor, options })),
  };
});

vi.mock('@dnd-kit/core', () => {
  return {
    closestCorners: vi.fn(),
    DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
    DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
    PointerSensor: dndMocks.PointerSensor,
    KeyboardSensor: dndMocks.KeyboardSensor,
    useSensor: dndMocks.useSensor,
    useSensors: (...sensors: unknown[]) => sensors,
    useDraggable: () => ({
      attributes: { role: 'button', tabIndex: 0 },
      listeners: { onPointerDown: dndMocks.dragPointerDown },
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    }),
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  };
});

vi.mock('@dnd-kit/sortable', () => ({
  sortableKeyboardCoordinates: dndMocks.sortableKeyboardCoordinates,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({
    data: {
      items: [
        {
          id: 'customer-1',
          customerName: '示例客户',
          customerLevel: 'A',
          chargerName: '销售甲',
          leadProgressStatus: 'ACTIVE',
          lastKeepRecordTime: new Date(2026, 8, 14, 15, 42).toISOString(),
          version: 1,
        },
      ],
      total: 1,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock('../CustomerLeadProgressModal', () => ({
  CustomerLeadProgressModal: ({ targetStatus }: { targetStatus: string }) => (
    <div data-testid="lead-progress-modal">{targetStatus}</div>
  ),
}));

describe('LeadsBoard keyboard accessibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('同时配置 PointerSensor 与 sortableKeyboardCoordinates KeyboardSensor', () => {
    render(<LeadsBoard apiParams={{}} canEdit onCardClick={vi.fn()} />);

    expect(dndMocks.useSensor).toHaveBeenCalledWith(dndMocks.PointerSensor, {
      activationConstraint: { distance: 5 },
    });
    expect(dndMocks.useSensor).toHaveBeenCalledWith(dndMocks.KeyboardSensor, {
      coordinateGetter: dndMocks.sortableKeyboardCoordinates,
    });
    expect(screen.getByRole('button', { name: '拖动 示例客户 调整线索状态' })).toBeTruthy();
  });

  it('客户名与正文各打开详情一次，操作按钮及专用拖拽手柄不冒泡', () => {
    const onCardClick = vi.fn();
    render(<LeadsBoard apiParams={{}} canEdit onCardClick={onCardClick} />);

    const customerName = screen.getByRole('button', { name: '示例客户' });
    const card = customerName.closest<HTMLElement>('.rounded-md');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('role')).toBeNull();
    expect(card?.getAttribute('tabindex')).toBeNull();
    expect(customerName.tagName).toBe('BUTTON');
    customerName.focus();
    expect(document.activeElement).toBe(customerName);

    fireEvent.click(customerName);
    fireEvent.click(screen.getByText('销售甲'));
    expect(onCardClick).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '安排拜访' }));
    expect(screen.getByTestId('lead-progress-modal').textContent).toBe('PENDING_VISIT');
    expect(onCardClick).toHaveBeenCalledTimes(2);

    const dragHandle = screen.getByRole('button', { name: '拖动 示例客户 调整线索状态' });
    fireEvent.pointerDown(dragHandle);
    fireEvent.click(dragHandle);
    expect(dndMocks.dragPointerDown).toHaveBeenCalledTimes(1);
    expect(onCardClick).toHaveBeenCalledTimes(2);
    expect(card?.querySelector('[role="button"] button')).toBeNull();
    expect(card?.querySelector('button button')).toBeNull();
  });

  it('最近跟进展示到分钟 YYYY-MM-DD HH:mm', () => {
    render(<LeadsBoard apiParams={{}} canEdit onCardClick={vi.fn()} />);
    expect(screen.getByText('最近跟进 2026-09-14 15:42')).toBeTruthy();
  });
});
