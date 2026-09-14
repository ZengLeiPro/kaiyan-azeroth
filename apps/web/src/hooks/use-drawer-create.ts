import { isAxiosError } from 'axios';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { api, getErrorMessage } from '@/lib/api';

export interface UseDrawerCreateOptions<TFormData> {
  /** 创建接口 endpoint，例如 `/contacts` */
  endpoint: string;
  /** 表单初始值（已合并 presets 的最终初始 state） */
  initialFormData: TFormData;
  /** zod schema，提交前自动校验；不传则不校验 */
  schema?: z.ZodType<TFormData>;
  /** 表单 → API payload 转换；不传则直接提交 formData */
  formToPayload?: (form: TFormData) => unknown;
  /** 创建成功回调（典型用途：drawerStack.pop 关闭抽屉） */
  onSuccess?: () => void;
}

export interface UseDrawerCreateReturn<TFormData> {
  formData: TFormData;
  setFormData: React.Dispatch<React.SetStateAction<TFormData>>;
  updateFormField: <K extends keyof TFormData>(field: K, value: TFormData[K]) => void;
  errors: z.ZodError<TFormData> | null;
  getFieldError: (field: keyof TFormData) => string | undefined;
  handleSubmit: () => Promise<boolean>;
  submitting: boolean;
}

/**
 * 抽屉栈内创建表单的轻量版 useCrud。
 *
 * 与 useCrud 的区别：
 * - 不绑定列表/分页/排序，只做单次创建
 * - 不维护 dialog 状态（外层 DrawerStack 已托管显隐）
 * - 提交成功后通过 onSuccess 通知外层 pop 抽屉，刷新由 RelatedEntityList 的 onPopBack 自动触发
 *
 * 使用场景：客户详情 Drawer 各 tab 内点击"新增"按钮，叠层弹出创建表单。
 */
export function useDrawerCreate<TFormData>(
  options: UseDrawerCreateOptions<TFormData>
): UseDrawerCreateReturn<TFormData> {
  const { endpoint, initialFormData, schema, formToPayload, onSuccess } = options;

  const [formData, setFormData] = useState<TFormData>(initialFormData);
  const [errors, setErrors] = useState<z.ZodError<TFormData> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateFormField = useCallback(
    <K extends keyof TFormData>(field: K, value: TFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setErrors((prevErrors) => {
        if (!prevErrors) return null;
        const remaining = prevErrors.issues.filter((i) => i.path[0] !== field);
        if (remaining.length === prevErrors.issues.length) return prevErrors;
        if (remaining.length === 0) return null;
        return new z.ZodError(remaining);
      });
    },
    []
  );

  const getFieldError = useCallback(
    (field: keyof TFormData): string | undefined => {
      if (!errors) return undefined;
      const issue = errors.issues.find((i) => i.path[0] === field);
      return issue?.message;
    },
    [errors]
  );

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    if (schema) {
      const result = schema.safeParse(formData);
      if (!result.success) {
        setErrors(result.error);
        const firstIssue = result.error.issues[0];
        if (firstIssue) toast.error(firstIssue.message);
        return false;
      }
      setErrors(null);
    }

    setSubmitting(true);
    try {
      const payload = formToPayload ? formToPayload(formData) : formData;
      await api.post(endpoint, payload);
      toast.success('创建成功');
      onSuccess?.();
      return true;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        toast.error('数据已被其他用户修改，请刷新后重试');
        return false;
      }
      toast.error(getErrorMessage(error, '创建失败'));
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [endpoint, schema, formData, formToPayload, onSuccess]);

  return useMemo(
    () => ({
      formData,
      setFormData,
      updateFormField,
      errors,
      getFieldError,
      handleSubmit,
      submitting,
    }),
    [formData, updateFormField, errors, getFieldError, handleSubmit, submitting]
  );
}
