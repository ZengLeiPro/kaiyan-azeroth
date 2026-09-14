import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { api, batchDelete, buildEntityVersionMap, getErrorMessage } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

import { invalidateAnalyticsQueries } from './analytics-invalidation';
import { useServerPagination, UseServerPaginationOptions } from './use-server-pagination';

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  goToPage: (page: number) => void;
  changePageSize: (size: number) => void;
  hasPrevPage: boolean;
  hasNextPage: boolean;
}

export interface SortingInfo {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  changeSort: (field: string, order?: 'asc' | 'desc') => void;
  clearSort: () => void;
  /**
   * 应用服务端全员默认排序（由 useColumnVisibility 在 fetch table-preference 成功时调用）。
   * 区别于 changeSort：不会重置到第一页；仅在 server version > 本地 applied version 时覆盖。
   */
  applyServerSorting: (
    sortBy: string | undefined,
    sortOrder: 'asc' | 'desc' | undefined,
    version: number
  ) => void;
  /**
   * admin 通过 ColumnVisibilityDropdown「保存为全员默认」后，把本地 appliedServerVersion 同步到 PUT 返回的新 version
   */
  markServerSortingVersionApplied: (version: number) => void;
}

export interface UseCrudOptions<T, TFormData = Partial<T>, TApiResponse = T> {
  /** API 端点 */
  endpoint: string;

  /** 初始表单数据 */
  initialFormData: TFormData;

  /**
   * Zod Schema 用于表单验证（可选）
   * 如果提供，handleSubmit 会在提交前自动验证
   * 验证失败会阻止提交并设置 errors
   */
  schema?: z.ZodType<TFormData>;

  /**
   * 验证模式（可选，默认 'onSubmit'）
   * - 'onSubmit': 仅在提交时验证
   * - 'onChange': 字段变化时即时验证（用户体验更好但性能略低）
   */
  validateMode?: 'onSubmit' | 'onChange';

  /** 将实体转换为表单数据 */
  entityToForm?: (entity: T) => TFormData;

  /** 将表单数据转换为 API 载荷 */
  formToPayload?: (form: TFormData) => unknown;

  /** 将表单数据转换为更新 API 载荷 */
  formToUpdatePayload?: (form: TFormData) => unknown;

  /** 自定义更新提交逻辑，例如 approved 单据保存时改走变更审批 */
  customUpdate?: (args: {
    entity: T;
    payload: unknown;
    endpoint: string;
  }) => Promise<{ message?: string } | void>;

  /**
   * 仅对明确启用的实体收紧写操作版本契约；默认 false，避免一次性改变所有 CRUD 实体。
   */
  requireVersion?: boolean;

  /** 获取实体显示名称（用于删除确认） */
  getEntityName?: (entity: T) => string;

  /** 禁用编辑功能（只允许查看和删除） */
  disableEdit?: boolean;

  /** 禁用删除功能（详情卡片上不显示删除按钮） */
  disableDelete?: boolean;

  /** useServerPagination 的额外选项 */
  paginationOptions?: Omit<UseServerPaginationOptions<T, TApiResponse>, 'endpoint'>;

  /**
   * 自定义数据转换函数
   * 用于在渲染前转换 API 返回的数据列表
   */
  transformData?: (data: TApiResponse[]) => T[];

  /**
   * 结构化 409 冲突回调（区别于乐观锁裸 409）。
   *
   * 当后端返回 409 且 body 含 `code` 字段时调用此回调，让上层决定是否重试。
   * 典型场景：客户软查重 (code='DUPLICATE_CUSTOMER')——弹卡让用户确认是建新还是用已有。
   *
   * - 返回 `{ retry: true, payloadOverride? }` → 用 override merge 到原 payload 后重试一次
   *   （例如客户软查重确认后传 `{ forceCreate: true }`）
   * - 返回 `{ retry: false }` 或 `null` → 不重试，由调用方自己处理（toast 等）
   */
  onConflict?: (errorData: {
    code?: string;
    message?: string;
    [key: string]: unknown;
  }) => Promise<{ retry: boolean; payloadOverride?: Record<string, unknown> } | null>;
}

export interface UseCrudReturn<T, TFormData> {
  data: T[];
  loading: boolean;
  error: Error | null;
  /** 请求失败但仍保留最近一次成功快照 */
  stale: boolean;
  /** 可直接传给 CrudTable 的统一请求状态，避免页面重复接线 */
  tableProps: {
    loading: boolean;
    error: Error | null;
    onRetry: () => void;
    stale: boolean;
  };
  pagination: PaginationInfo;
  sorting: SortingInfo;
  refresh: () => void;

  keyword: string;
  setKeyword: (keyword: string) => void;

  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  isViewMode: boolean;
  setIsViewMode: (isView: boolean) => void;
  isEditing: boolean;
  editingEntity: T | null;

  formData: TFormData;
  setFormData: React.Dispatch<React.SetStateAction<TFormData>>;
  updateFormField: <K extends keyof TFormData>(field: K, value: TFormData[K]) => void;

  // ========== Zod 验证相关 (新增) ==========
  /**
   * 当前表单的验证错误
   * 如果没有错误或未传入 schema，则为 null
   */
  errors: z.ZodError<TFormData> | null;

  /**
   * 获取指定字段的错误信息
   * @param field 字段名
   * @returns 错误信息字符串，如果无错误则返回 undefined
   */
  getFieldError: (field: keyof TFormData) => string | undefined;

  /**
   * 表单是否通过验证
   * 如果未传入 schema，始终返回 true
   */
  isValid: boolean;

  /**
   * 手动触发验证
   * @returns 验证是否通过
   */
  validate: () => boolean;

  /**
   * 清除所有验证错误
   */
  clearErrors: () => void;
  // ========================================

  openCreateDialog: () => void;
  openEditDialog: (entity: T) => void;
  openViewDialog: (entity: T) => void;
  enterEditMode: () => void;
  closeDialog: () => void;
  handleSubmit: () => Promise<boolean>;
  create: (data: TFormData) => Promise<T | null>;
  update: (id: string, data: Partial<TFormData>) => Promise<T | null>;
  submitLoading: boolean;

  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
  deletingEntity: T | null;
  openDeleteDialog: (entity: T) => void;
  handleDelete: () => Promise<boolean>;
  deleteLoading: boolean;

  formDialogProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    mode: 'view' | 'edit' | 'create';
    onModeChange?: () => void;
    onSubmit: () => Promise<boolean>;
    onDelete?: () => void;
    loading: boolean;
  };
  deleteConfirmProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityName: string;
    onConfirm: () => Promise<boolean>;
    loading: boolean;
  };

  selectedKeys: Set<string>;
  setSelectedKeys: (keys: Set<string>) => void;
  clearSelection: () => void;
  openBulkDeleteDialog: () => void;
  handleBulkDelete: () => Promise<boolean>;
  bulkDeleteLoading: boolean;

  rowSelectionProps: {
    selectedKeys: Set<string>;
    onSelectionChange: (keys: Set<string>) => void;
  };

  bulkDeleteConfirmProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedCount: number;
    onConfirm: () => Promise<boolean>;
    loading: boolean;
  };
}

const REQUIRED_VERSION_MESSAGE = '数据版本缺失或无效，请刷新后重试';

function hasPositiveIntegerVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function readPayloadVersion(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined;
  return (payload as { version?: unknown }).version;
}

function hasExactVersionMap(ids: string[], versions: Record<string, number>): boolean {
  const idSet = new Set(ids);
  const versionIds = Object.keys(versions);
  return (
    versionIds.length === ids.length &&
    versionIds.every((id) => idSet.has(id)) &&
    ids.every((id) => hasPositiveIntegerVersion(versions[id]))
  );
}

export function useCrud<T extends { id: string }, TFormData = Partial<T>, TApiResponse = T>(
  options: UseCrudOptions<T, TFormData, TApiResponse>
): UseCrudReturn<T, TFormData> {
  const {
    endpoint,
    initialFormData,
    schema,
    validateMode = 'onSubmit',
    entityToForm,
    formToPayload,
    formToUpdatePayload,
    customUpdate,
    requireVersion = false,
    getEntityName = (entity) => (entity as { name?: string }).name || entity.id,
    disableEdit = false,
    disableDelete = false,
    paginationOptions = {},
    transformData,
    onConflict,
  } = options;

  const [keyword, setKeyword] = useState('');

  const serverPagination = useServerPagination<T, TApiResponse>({
    endpoint,
    ...paginationOptions,
    extraParams: useMemo(
      () => ({
        ...paginationOptions.extraParams,
        // 只有当内部 keyword 有值时才覆盖 extraParams 中的 keyword
        ...(keyword ? { keyword } : {}),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [keyword, JSON.stringify(paginationOptions.extraParams)]
    ),
  });

  const refreshAfterMutation = useCallback(async () => {
    serverPagination.refresh();
    await invalidateAnalyticsQueries(queryClient, endpoint);
  }, [endpoint, serverPagination]);

  // Apply custom data transformation if provided
  const transformedData = useMemo(() => {
    if (transformData && serverPagination.data) {
      return transformData(serverPagination.data);
    }
    // @ts-expect-error TApiResponse is assumed compatible with T when no transformData is provided
    return serverPagination.data as T[];
  }, [serverPagination.data, transformData]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isViewMode, setIsViewMode] = useState(true);
  const [editingEntity, setEditingEntity] = useState<T | null>(null);

  const [formData, setFormData] = useState<TFormData>(initialFormData);
  const [submitLoading, setSubmitLoading] = useState(false);

  // ========== Zod 验证状态 (新增) ==========
  const [errors, setErrors] = useState<z.ZodError<TFormData> | null>(null);
  // ========================================

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEntity, setDeletingEntity] = useState<T | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  useEffect(() => {
    clearSelection();
  }, [serverPagination.pagination.page, serverPagination.pagination.pageSize, clearSelection]);

  // ========== Zod 验证函数 (新增) ==========

  /**
   * 执行表单验证
   * @returns 验证是否通过
   */
  const validate = useCallback((): boolean => {
    if (!schema) return true;

    const result = schema.safeParse(formData);
    if (!result.success) {
      setErrors(result.error);
      return false;
    }
    setErrors(null);
    return true;
  }, [schema, formData]);

  /**
   * 获取指定字段的错误信息
   */
  const getFieldError = useCallback(
    (field: keyof TFormData): string | undefined => {
      if (!errors) return undefined;
      const issue = errors.issues.find((i) => i.path[0] === field);
      return issue?.message;
    },
    [errors]
  );

  /**
   * 清除所有验证错误
   */
  const clearErrors = useCallback(() => {
    setErrors(null);
  }, []);

  /**
   * 表单是否有效
   */
  const isValid = useMemo(() => {
    if (!schema) return true;
    return errors === null || errors.issues.length === 0;
  }, [schema, errors]);

  // ========================================

  const openCreateDialog = useCallback(() => {
    setEditingEntity(null);
    setFormData(initialFormData);
    setErrors(null); // 清除之前的错误
    setIsViewMode(false);
    setDialogOpen(true);
  }, [initialFormData]);

  const openEditDialog = useCallback(
    (entity: T) => {
      setEditingEntity(entity);
      // @ts-expect-error If no entityToForm is provided, we assume T is compatible with TFormData
      setFormData(entityToForm ? entityToForm(entity) : (entity as TFormData));
      setErrors(null); // 清除之前的错误
      setIsViewMode(false); // 编辑模式，非查看模式
      setDialogOpen(true);
    },
    [entityToForm]
  );

  const openViewDialog = useCallback(
    (entity: T) => {
      setEditingEntity(entity);
      // @ts-expect-error If no entityToForm is provided, we assume T is compatible with TFormData
      setFormData(entityToForm ? entityToForm(entity) : (entity as TFormData));
      setErrors(null); // 清除之前的错误
      setIsViewMode(true);
      setDialogOpen(true);
    },
    [entityToForm]
  );

  const enterEditMode = useCallback(() => {
    setIsViewMode(false);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setIsViewMode(true);
    setErrors(null); // 关闭时清除错误
  }, []);

  /**
   * 更新表单字段
   * - onChange 模式：更新后立即重新验证整张表单
   * - onSubmit 模式：清除该字段的旧错误（避免用户提交失败后修正字段，红字一直挂在那里）
   */
  const updateFormField = useCallback(
    <K extends keyof TFormData>(field: K, value: TFormData[K]) => {
      setFormData((prev) => {
        const newData = { ...prev, [field]: value };

        if (validateMode === 'onChange' && schema) {
          const result = schema.safeParse(newData);
          if (!result.success) {
            setErrors(result.error);
          } else {
            setErrors(null);
          }
        } else {
          // onSubmit 模式：用户修改某个字段后立即清除该字段的旧错误
          setErrors((prevErrors) => {
            if (!prevErrors) return null;
            const remaining = prevErrors.issues.filter((i) => i.path[0] !== field);
            if (remaining.length === prevErrors.issues.length) return prevErrors;
            if (remaining.length === 0) return null;
            return new z.ZodError(remaining);
          });
        }

        return newData;
      });
    },
    [schema, validateMode]
  );

  /**
   * 提交表单
   * 如果传入了 schema，会先进行验证
   */
  const handleSubmit = useCallback(async (): Promise<boolean> => {
    // 如果有 schema，先验证
    if (schema) {
      const result = schema.safeParse(formData);
      if (!result.success) {
        setErrors(result.error);
        // 显示第一个错误
        const firstIssue = result.error.issues[0];
        if (firstIssue) {
          toast.error(firstIssue.message);
        }
        return false;
      }
      setErrors(null);
    }

    const isUpdate = !!editingEntity;
    const basePayload = isUpdate
      ? formToUpdatePayload
        ? formToUpdatePayload(formData)
        : formToPayload
          ? formToPayload(formData)
          : formData
      : formToPayload
        ? formToPayload(formData)
        : formData;
    if (isUpdate && requireVersion && !hasPositiveIntegerVersion(readPayloadVersion(basePayload))) {
      toast.error(REQUIRED_VERSION_MESSAGE);
      return false;
    }

    const buildPayload = (override?: Record<string, unknown>) =>
      override ? { ...(basePayload as object), ...override } : basePayload;
    setSubmitLoading(true);
    const submitOnce = async (
      override?: Record<string, unknown>
    ): Promise<{ message?: string } | void> => {
      const payload = buildPayload(override);
      if (isUpdate) {
        if (customUpdate) {
          return customUpdate({ entity: editingEntity!, payload, endpoint });
        }
        await api.put(`${endpoint}/${editingEntity!.id}`, payload);
        return undefined;
      } else {
        await api.post(endpoint, payload);
        return undefined;
      }
    };

    try {
      const result = await submitOnce();
      toast.success(result?.message ?? (isUpdate ? '更新成功' : '创建成功'));
      setDialogOpen(false);
      setIsViewMode(true);
      setErrors(null);
      await refreshAfterMutation();
      return true;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        // 结构化 409（含 code 字段）→ 走 onConflict 回调，让上层决定是否带 override 重试
        const data = error.response?.data as
          | { code?: string; message?: string; [k: string]: unknown }
          | undefined;
        if (data?.code && onConflict) {
          const decision = await onConflict(data);
          if (decision?.retry) {
            try {
              const result = await submitOnce(decision.payloadOverride);
              toast.success(result?.message ?? (isUpdate ? '更新成功' : '创建成功'));
              setDialogOpen(false);
              setIsViewMode(true);
              setErrors(null);
              await refreshAfterMutation();
              return true;
            } catch (retryError) {
              toast.error(getErrorMessage(retryError, '操作失败'));
              return false;
            }
          }
          // 用户取消重试 → 不弹默认乐观锁 toast，交由上层处理
          return false;
        }
        // 默认乐观锁裸 409
        toast.error('数据已被其他用户修改，请刷新后重试');
        serverPagination.refresh();
        setDialogOpen(false);
        return false;
      }
      toast.error(getErrorMessage(error, '操作失败'));
      return false;
    } finally {
      setSubmitLoading(false);
    }
  }, [
    schema,
    endpoint,
    editingEntity,
    formData,
    formToPayload,
    formToUpdatePayload,
    customUpdate,
    requireVersion,
    serverPagination,
    refreshAfterMutation,
    onConflict,
  ]);

  const create = useCallback(
    async (data: TFormData): Promise<T | null> => {
      // 如果有 schema，先验证
      if (schema) {
        const result = schema.safeParse(data);
        if (!result.success) {
          setErrors(result.error);
          const firstError = result.error.issues[0]?.message;
          if (firstError) {
            toast.error(firstError);
          }
          return null;
        }
      }

      setSubmitLoading(true);
      try {
        const payload = formToPayload ? formToPayload(data) : data;
        const response = await api.post<T>(endpoint, payload);
        toast.success('创建成功');
        setDialogOpen(false);
        setIsViewMode(true);
        setErrors(null);
        await refreshAfterMutation();
        return response.data;
      } catch (error) {
        toast.error(getErrorMessage(error, '创建失败'));
        return null;
      } finally {
        setSubmitLoading(false);
      }
    },
    [schema, endpoint, formToPayload, refreshAfterMutation]
  );

  const update = useCallback(
    async (id: string, data: Partial<TFormData>): Promise<T | null> => {
      // 注意：update 方法通常用于部分更新，这里暂不做完整 schema 验证；
      // requireVersion opt-in 仍必须在 loading 与任何请求之前校验版本。
      const payload = formToUpdatePayload
        ? formToUpdatePayload(data as TFormData)
        : formToPayload
          ? formToPayload(data as TFormData)
          : data;
      if (requireVersion && !hasPositiveIntegerVersion(readPayloadVersion(payload))) {
        toast.error(REQUIRED_VERSION_MESSAGE);
        return null;
      }

      setSubmitLoading(true);
      try {
        const response = await api.put<T>(`${endpoint}/${id}`, payload);
        toast.success('更新成功');
        setDialogOpen(false);
        setIsViewMode(true);
        setErrors(null);
        await refreshAfterMutation();
        return response.data;
      } catch (error) {
        toast.error(getErrorMessage(error, '更新失败'));
        return null;
      } finally {
        setSubmitLoading(false);
      }
    },
    [endpoint, formToUpdatePayload, formToPayload, requireVersion, refreshAfterMutation]
  );

  const openDeleteDialog = useCallback((entity: T) => {
    setDeletingEntity(entity);
    setDeleteDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async (): Promise<boolean> => {
    if (!deletingEntity) return false;

    const entityVersion = (deletingEntity as { version?: number | null }).version;
    if (requireVersion && !hasPositiveIntegerVersion(entityVersion)) {
      toast.error(REQUIRED_VERSION_MESSAGE);
      return false;
    }

    setDeleteLoading(true);
    try {
      // 软删除带乐观锁：若实体上有 version 字段，附加到 query 让后端走 CAS。
      // 实体若无 version（极少数纯系统模型），退化为按 id 删除。
      const versionQuery =
        entityVersion != null && Number.isInteger(entityVersion) ? `?version=${entityVersion}` : '';
      await api.delete(`${endpoint}/${deletingEntity.id}${versionQuery}`);
      toast.success('删除成功');
      setDeleteDialogOpen(false);
      setDeletingEntity(null);
      if (editingEntity?.id === deletingEntity.id) {
        setDialogOpen(false);
      }
      await refreshAfterMutation();
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, '删除失败'));
      return false;
    } finally {
      setDeleteLoading(false);
    }
  }, [endpoint, deletingEntity, editingEntity, requireVersion, refreshAfterMutation]);

  const openBulkDeleteDialog = useCallback(() => {
    if (selectedKeys.size > 0) {
      setBulkDeleteConfirmOpen(true);
    }
  }, [selectedKeys]);

  const handleBulkDelete = useCallback(async (): Promise<boolean> => {
    if (selectedKeys.size === 0) return false;

    const ids = Array.from(selectedKeys);
    const versions = buildEntityVersionMap(
      transformedData.filter((entity) => selectedKeys.has(entity.id))
    );
    if (requireVersion && !hasExactVersionMap(ids, versions)) {
      toast.error(REQUIRED_VERSION_MESSAGE);
      return false;
    }

    setBulkDeleteLoading(true);
    try {
      const result = await batchDelete(endpoint, ids, { versions });
      const reasonSample = Array.from(
        new Set(result.errors.map((item) => item.error).filter(Boolean))
      )
        .slice(0, 2)
        .join('；');

      if (result.success === 0) {
        toast.error(`未删除任何记录${reasonSample ? `：${reasonSample}` : ''}`);
        setBulkDeleteConfirmOpen(false);
        return false;
      }
      if (result.failed > 0) {
        toast.warning(
          `成功删除 ${result.success} 项，跳过 ${result.failed} 项${reasonSample ? `：${reasonSample}` : ''}`
        );
      } else {
        toast.success(`成功删除 ${result.success} 项`);
      }
      setBulkDeleteConfirmOpen(false);
      clearSelection();
      await refreshAfterMutation();
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, '批量删除失败'));
      return false;
    } finally {
      setBulkDeleteLoading(false);
    }
  }, [
    endpoint,
    selectedKeys,
    transformedData,
    requireVersion,
    clearSelection,
    refreshAfterMutation,
  ]);

  const rowSelectionProps = useMemo(
    () => ({
      selectedKeys,
      onSelectionChange: setSelectedKeys,
    }),
    [selectedKeys]
  );

  const bulkDeleteConfirmProps = useMemo(
    () => ({
      open: bulkDeleteConfirmOpen,
      onOpenChange: setBulkDeleteConfirmOpen,
      selectedCount: selectedKeys.size,
      onConfirm: handleBulkDelete,
      loading: bulkDeleteLoading,
    }),
    [bulkDeleteConfirmOpen, selectedKeys.size, handleBulkDelete, bulkDeleteLoading]
  );

  const formDialogProps = useMemo(
    () => ({
      open: dialogOpen,
      onOpenChange: (open: boolean) => {
        if (!open) closeDialog();
        else setDialogOpen(open);
      },
      title: editingEntity ? (isViewMode ? '详情' : '编辑') : '新建',
      mode: (!editingEntity ? 'create' : isViewMode ? 'view' : 'edit') as
        | 'view'
        | 'edit'
        | 'create',
      onModeChange: disableEdit ? undefined : enterEditMode,
      onSubmit: handleSubmit,
      onDelete:
        editingEntity && !disableDelete
          ? () => {
              closeDialog();
              openDeleteDialog(editingEntity);
            }
          : undefined,
      loading: submitLoading,
    }),
    [
      dialogOpen,
      editingEntity,
      isViewMode,
      disableEdit,
      disableDelete,
      closeDialog,
      enterEditMode,
      handleSubmit,
      openDeleteDialog,
      submitLoading,
    ]
  );

  const deleteConfirmProps = useMemo(
    () => ({
      open: deleteDialogOpen,
      onOpenChange: setDeleteDialogOpen,
      entityName: deletingEntity ? getEntityName(deletingEntity) : '',
      onConfirm: handleDelete,
      loading: deleteLoading,
    }),
    [deleteDialogOpen, deletingEntity, getEntityName, handleDelete, deleteLoading]
  );

  const tableProps = useMemo(
    () => ({
      loading: serverPagination.loading,
      error: serverPagination.error,
      onRetry: serverPagination.refresh,
      stale: serverPagination.error !== null && transformedData.length > 0,
    }),
    [
      serverPagination.loading,
      serverPagination.error,
      serverPagination.refresh,
      transformedData.length,
    ]
  );

  return {
    ...serverPagination,
    data: transformedData,
    tableProps,
    keyword,
    setKeyword,
    dialogOpen,
    setDialogOpen,
    isViewMode,
    setIsViewMode,
    isEditing: editingEntity !== null,
    editingEntity,
    formData,
    setFormData,
    updateFormField,
    // Zod 验证相关 (新增)
    errors,
    getFieldError,
    isValid,
    validate,
    clearErrors,
    // 其他
    openCreateDialog,
    openEditDialog,
    openViewDialog,
    enterEditMode,
    closeDialog,
    handleSubmit,
    create,
    update,
    submitLoading,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deletingEntity,
    openDeleteDialog,
    handleDelete,
    deleteLoading,
    formDialogProps,
    deleteConfirmProps,
    selectedKeys,
    setSelectedKeys,
    clearSelection,
    openBulkDeleteDialog,
    handleBulkDelete,
    bulkDeleteLoading,
    rowSelectionProps,
    bulkDeleteConfirmProps,
  };
}
