import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, value, onChange, ...props }, ref) => {
    const isNumber = type === 'number';

    // 数字输入框：内部用字符串管理显示值，允许清空
    const [displayValue, setDisplayValue] = React.useState(() =>
      isNumber && value != null && value !== '' ? String(value) : ''
    );
    const isFocused = React.useRef(false);

    // 外部 value 变化时同步（仅在非聚焦状态，避免打断用户输入）
    React.useEffect(() => {
      if (isNumber && !isFocused.current) {
        setDisplayValue(value != null && value !== '' ? String(value) : '');
      }
    }, [isNumber, value]);

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isNumber) {
          setDisplayValue(e.target.value);
        }
        onChange?.(e);
      },
      [isNumber, onChange]
    );

    const handleFocus = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        isFocused.current = true;
        // 聚焦时自动全选，用户可直接输入新值覆盖
        if (isNumber) {
          e.target.select();
        }
      },
      [isNumber]
    );

    const handleBlur = React.useCallback(() => {
      isFocused.current = false;
      // 失焦时同步外部值
      if (isNumber) {
        setDisplayValue(value != null && value !== '' ? String(value) : '');
      }
    }, [isNumber, value]);

    // 数字输入框禁用滚轮改值（防止滚动页面时意外修改数值）
    const handleWheel = React.useCallback(
      (e: React.WheelEvent<HTMLInputElement>) => {
        if (isNumber) {
          (e.target as HTMLInputElement).blur();
        }
      },
      [isNumber]
    );

    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
        {...(isNumber
          ? {
              value: displayValue,
              onChange: handleChange,
              onFocus: handleFocus,
              onBlur: handleBlur,
              onWheel: handleWheel,
            }
          : { value, onChange })}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
