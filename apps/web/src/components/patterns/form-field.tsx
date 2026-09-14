import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// ========== Context ==========

type FormMode = 'view' | 'edit' | 'create';

interface FormModeContextValue {
  mode: FormMode;
}

const FormModeContext = createContext<FormModeContextValue>({ mode: 'view' });

export function FormModeProvider({ mode, children }: { mode: FormMode; children: ReactNode }) {
  const value = useMemo(() => ({ mode }), [mode]);
  return <FormModeContext.Provider value={value}>{children}</FormModeContext.Provider>;
}

/**
 * 读取当前 FormModeContext。供需要根据 view/edit/create 模式
 * 控制 disabled、onClick 等行为的 fields 渲染函数使用。
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook 与 FormModeProvider 紧耦合，拆文件得不偿失
export function useFormMode() {
  return useContext(FormModeContext);
}

// ========== FormField ==========

export interface FormFieldProps {
  /** 字段名，关联 label 的 htmlFor（编辑态） */
  name: string;
  /** 字段标签 */
  label: ReactNode;
  /** 是否必填（编辑态显示红色星号） */
  required?: boolean;
  /** 验证错误信息，通常传 crud.getFieldError(name) */
  error?: string;
  /** 帮助文本（编辑态，error 不存在时显示） */
  helpText?: string;
  /** 查看态展示内容 */
  viewContent?: ReactNode;
  /** 编辑态表单控件 */
  children?: ReactNode;
  /** 额外 CSS 类名 */
  className?: string;
  /** 强制以查看态渲染，忽略 FormModeContext（用于始终只读的字段） */
  forceView?: boolean;
  /**
   * 跨双列：在 FormDialog grid-cols-2 容器中占满整行
   * 适用于：Textarea / 富文本 / 地址级联 / 多选标签 / 附件上传等长字段
   */
  fullRow?: boolean;
}

export function FormField({
  name,
  label,
  required,
  error,
  helpText,
  viewContent,
  children,
  className,
  forceView,
  fullRow,
}: FormFieldProps) {
  const { mode } = useFormMode();
  const isView = forceView || mode === 'view';
  const editableRootRef = useRef<HTMLDivElement>(null);
  const helpTextId = `${name}-help`;
  const errorId = `${name}-error`;
  const explicitChildId =
    isValidElement(children) && typeof children.props.id === 'string'
      ? children.props.id
      : undefined;
  const controlId = explicitChildId ?? name;
  const describedBy = error ? errorId : helpText ? helpTextId : undefined;
  const editableControl = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: controlId,
        'aria-invalid': children.props['aria-invalid'] ?? Boolean(error),
        'aria-describedby': children.props['aria-describedby'] ?? describedBy,
      })
    : children;

  useLayoutEffect(() => {
    if (isView) return;
    const root = editableRootRef.current;
    const control = root?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, select, button, [role="combobox"], [role="switch"], [tabindex]:not([tabindex="-1"])'
    );
    if (!control) return;

    // 复合控件常把 FormField clone 进来的属性落在外层 div；
    // 只保留 focusable trigger 上的关联，避免 label 指向不可聚焦节点。
    for (const element of root?.querySelectorAll<HTMLElement>('[id]') ?? []) {
      if (element !== control && element.id === controlId) element.removeAttribute('id');
    }
    control.id = controlId;
    control.setAttribute('aria-invalid', String(Boolean(error)));
    if (describedBy) {
      control.setAttribute('aria-describedby', describedBy);
    } else if (
      control.getAttribute('aria-describedby') === helpTextId ||
      control.getAttribute('aria-describedby') === errorId
    ) {
      control.removeAttribute('aria-describedby');
    }
  }, [controlId, describedBy, error, errorId, helpTextId, isView]);

  return (
    <div className={cn('space-y-2', fullRow && 'col-span-1 md:col-span-2', className)}>
      <Label htmlFor={!isView ? controlId : undefined}>
        {label}
        {required && !isView && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {isView ? (
        <div className="flex min-h-[40px] w-full items-center whitespace-pre-wrap break-words rounded-md bg-muted/50 px-3 py-2 text-sm">
          {viewContent ?? <span className="text-muted-foreground">-</span>}
        </div>
      ) : (
        <>
          <div ref={editableRootRef} className="contents">
            {editableControl}
          </div>
          {helpText && !error && (
            <p id={helpTextId} className="text-xs text-muted-foreground">
              {helpText}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-xs text-destructive" role="alert" aria-live="polite">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
