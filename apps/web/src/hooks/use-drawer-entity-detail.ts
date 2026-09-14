import { getEntityDisplayName, isDisplayableEntityType } from '@ky-azeroth/shared/utils';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { useSetBeforeCloseGuard } from '@/components/patterns/drawer-stack/before-close-context';
import { type DrawerEntityType, useDrawerStack } from '@/components/patterns/drawer-stack/context';
import { api, getErrorMessage } from '@/lib/api';

import { useFetchEntity } from './use-fetch-entity';

interface DrawerUpdateResult<TResp> {
  message?: string;
  /** 自定义更新可选返回服务端最新实体快照；普通 PUT 默认会返回。 */
  data?: TResp;
}

export interface UseDrawerEntityDetailOptions<TResp, TForm> {
  /** API endpoint，例如 `/contacts`（拼接 id 后得到 `/contacts/<id>`） */
  endpoint: string;
  /** 实体 id（来自 DrawerEntry.id） */
  id: string;
  /** 实体类型，用于保存/删除后 notifyEntityChanged 通知上层列表刷新 */
  entityType: DrawerEntityType;
  /** zod schema，提交前自动校验；不传则不校验 */
  schema?: z.ZodType<TForm>;
  /** API 响应 → 表单数据 */
  toFormData: (resp: TResp) => TForm;
  /** 表单数据 → API payload（含 version 等乐观锁字段） */
  toPayload: (form: TForm) => unknown;
  /** 自定义更新提交逻辑，例如 approved 单据保存时改走变更审批 */
  customUpdate?: (args: {
    entity: TResp;
    payload: unknown;
    endpoint: string;
    id: string;
  }) => Promise<DrawerUpdateResult<TResp> | void>;
  /**
   * 用于 DeleteConfirm 显示的实体名称。
   * 不传时默认走 `getEntityDisplayName(entityType, resp, 'long')`（统一规约）；
   * 仅在 `entityType` 不在统一规约覆盖范围（如 customer/contact/keep-record/visit-record）
   * 或需要特殊文案时才需要显式传入。
   */
  entityNameOf?: (resp: TResp) => string;
}

/** 默认实体名解析：覆盖范围内的实体走统一规约 long 形态，否则走通用兜底 */
function defaultEntityNameOf<TResp>(entityType: DrawerEntityType, resp: TResp): string {
  if (isDisplayableEntityType(entityType)) {
    return getEntityDisplayName(entityType, resp as never, 'long');
  }
  const anyResp = resp as { name?: unknown; title?: unknown; id?: unknown };
  const candidates = [anyResp.name, anyResp.title, anyResp.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function getDeleteVersion(entity: unknown): number | null {
  if (!entity || typeof entity !== 'object' || !('version' in entity)) return null;
  const version = (entity as { version?: unknown }).version;
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : null;
}

interface CommittedDrawerToken {
  identity: string;
  generation: number;
  mounted: boolean;
}

export type DrawerDetailMode = 'view' | 'edit';

export interface UseDrawerEntityDetailReturn<TResp, TForm> {
  data: TResp | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;

  mode: DrawerDetailMode;
  isDirty: boolean;

  formData: TForm;
  updateFormField: <K extends keyof TForm>(field: K, value: TForm[K]) => void;
  getFieldError: (field: keyof TForm) => string | undefined;

  enterEditMode: () => void;
  /** 取消编辑：若 dirty 会先弹原生 confirm 让用户确认 */
  exitEditMode: () => void;
  handleSave: () => Promise<void>;
  saving: boolean;

  requestDelete: () => void;
  deleteConfirmProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityName: string;
    onConfirm: () => Promise<void>;
    loading: boolean;
  };
}

const DISCARD_CONFIRM_TEXT = '当前有未保存的修改，确认放弃？';
const INVALID_DELETE_VERSION_TEXT = '无法删除：当前实体缺少有效版本号，请刷新后重试';

/**
 * 二级抽屉详情视图通用 CRUD hook：fetch + view↔edit 切换 + save (PUT) + delete + dirty 追踪 +
 * close guard 注册。配合 EntityHeaderActions / EntityDetailBody / useEntityHeaderActions 使用。
 *
 * endpoint + id 共同定义实体 identity。render 只计算基于最后一次 commit 的候选 token，并通过
 * identity-tagged state 同步隐藏旧状态；identity/generation、mapper 与 mounted 状态只在 layout
 * commit 发布，因此 Suspense 中止的 render 不会污染仍然有效的已提交实体闭包。
 */
export function useDrawerEntityDetail<TResp, TForm>(
  options: UseDrawerEntityDetailOptions<TResp, TForm>
): UseDrawerEntityDetailReturn<TResp, TForm> {
  const {
    endpoint,
    id,
    entityType,
    schema,
    toFormData,
    toPayload,
    customUpdate,
    entityNameOf = (resp) => defaultEntityNameOf(entityType, resp),
  } = options;
  const drawerStack = useDrawerStack();
  const setBeforeCloseGuard = useSetBeforeCloseGuard();

  const identity = JSON.stringify([endpoint, id]);
  const committedRef = useRef<CommittedDrawerToken>({
    identity,
    generation: 1,
    mounted: false,
  });
  const saveSequenceRef = useRef(0);
  const deleteSequenceRef = useRef(0);

  // 只读最后一次 commit；候选 token 不在 render 中写 ref，aborted render 因而不会污染 A。
  const committed = committedRef.current;
  const generation =
    committed.identity === identity ? committed.generation : committed.generation + 1;

  const { data, loading, error, refetch, commitData } = useFetchEntity<TResp>(endpoint, id);

  const emptyFormData = useMemo(() => ({}) as TForm, []);
  const [stateIdentity, setStateIdentity] = useState(identity);
  const [mode, setMode] = useState<DrawerDetailMode>('view');
  const [formData, setFormData] = useState<TForm>(emptyFormData);
  const [initialFormData, setInitialFormData] = useState<TForm | null>(null);
  const [errors, setErrors] = useState<z.ZodError<TForm> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // render 只做 identity-tagged 投影；即使新 identity 尚未 commit，也绝不暴露旧表单/错误/弹窗。
  const hasCurrentState = stateIdentity === identity;
  const visibleMode: DrawerDetailMode = hasCurrentState ? mode : 'view';
  const visibleFormData = hasCurrentState ? formData : emptyFormData;
  const visibleInitialFormData = hasCurrentState ? initialFormData : null;
  const visibleErrors = hasCurrentState ? errors : null;
  const visibleSaving = hasCurrentState ? saving : false;
  const visibleDeleteOpen = hasCurrentState ? deleteOpen : false;
  const visibleDeleting = hasCurrentState ? deleting : false;

  // 调用侧常在 render 中声明 mapper / update 回调。ref 只发布最后一次 commit 的实现，避免
  // Suspense aborted render 泄漏新 mapper，同时保持事件回调稳定并读取最新已提交实现。
  const schemaRef = useRef(schema);
  const toFormDataRef = useRef(toFormData);
  const toPayloadRef = useRef(toPayload);
  const customUpdateRef = useRef(customUpdate);

  const isCurrentGeneration = useCallback(() => {
    const current = committedRef.current;
    return current.mounted && current.identity === identity && current.generation === generation;
  }, [generation, identity]);

  // commit 才发布 identity/generation；cleanup 在真正卸载或已提交 identity 切换时同步失效旧操作。
  useLayoutEffect(() => {
    const previous = committedRef.current;
    if (previous.identity !== identity || previous.generation !== generation) {
      saveSequenceRef.current += 1;
      deleteSequenceRef.current += 1;
    }
    committedRef.current = { identity, generation, mounted: true };

    return () => {
      const current = committedRef.current;
      if (current.identity !== identity || current.generation !== generation) return;
      committedRef.current = { ...current, mounted: false };
      saveSequenceRef.current += 1;
      deleteSequenceRef.current += 1;
    };
  }, [generation, identity]);

  useLayoutEffect(() => {
    schemaRef.current = schema;
    toFormDataRef.current = toFormData;
    toPayloadRef.current = toPayload;
    customUpdateRef.current = customUpdate;
  }, [customUpdate, schema, toFormData, toPayload]);

  // identity 真正 commit 后再重置本地 UI 状态；layout 更新会在用户可交互前同步完成。
  useLayoutEffect(() => {
    if (stateIdentity === identity) return;
    setStateIdentity(identity);
    setMode('view');
    setFormData(emptyFormData);
    setInitialFormData(null);
    setErrors(null);
    setSaving(false);
    setDeleteOpen(false);
    setDeleting(false);
  }, [emptyFormData, identity, stateIdentity]);

  const dataVersion =
    data && typeof data === 'object' && 'version' in data
      ? (data as { version?: unknown }).version
      : undefined;

  // data 身份或乐观锁版本变化时同步表单。edit 期间不覆盖输入；保存响应通过 commitData
  // 先写入最新快照，切回 view 后再以服务端 version 重建表单。
  useEffect(() => {
    if (!isCurrentGeneration() || !hasCurrentState || !data || visibleMode === 'edit') {
      return;
    }
    const next = toFormDataRef.current(data);
    setFormData(next);
    setInitialFormData(next);
    setErrors(null);
  }, [data, dataVersion, hasCurrentState, isCurrentGeneration, visibleMode]);

  const isDirty = useMemo(() => {
    if (visibleMode !== 'edit' || !visibleInitialFormData) return false;
    return JSON.stringify(visibleFormData) !== JSON.stringify(visibleInitialFormData);
  }, [visibleMode, visibleFormData, visibleInitialFormData]);

  const updateFormField = useCallback(
    <K extends keyof TForm>(field: K, value: TForm[K]) => {
      if (!isCurrentGeneration()) return;
      setFormData((previous) => ({ ...previous, [field]: value }));
      setErrors((previousErrors) => {
        if (!previousErrors) return null;
        const remaining = previousErrors.issues.filter((issue) => issue.path[0] !== field);
        if (remaining.length === previousErrors.issues.length) return previousErrors;
        if (remaining.length === 0) return null;
        return new z.ZodError(remaining);
      });
    },
    [isCurrentGeneration]
  );

  const getFieldError = useCallback(
    (field: keyof TForm): string | undefined => {
      if (!visibleErrors) return undefined;
      return visibleErrors.issues.find((issue) => issue.path[0] === field)?.message;
    },
    [visibleErrors]
  );

  const enterEditMode = useCallback(() => {
    if (!isCurrentGeneration() || !data) return;
    const next = toFormDataRef.current(data);
    setFormData(next);
    setInitialFormData(next);
    setErrors(null);
    setMode('edit');
  }, [data, isCurrentGeneration]);

  const exitEditMode = useCallback(() => {
    if (!isCurrentGeneration()) return;
    if (isDirty) {
      const confirmed = typeof window !== 'undefined' ? window.confirm(DISCARD_CONFIRM_TEXT) : true;
      if (!confirmed) return;
    }
    if (visibleInitialFormData) setFormData(visibleInitialFormData);
    setErrors(null);
    setMode('view');
  }, [isCurrentGeneration, isDirty, visibleInitialFormData]);

  const handleSave = useCallback(async () => {
    if (!isCurrentGeneration() || !data) return;

    const currentSchema = schemaRef.current;
    if (currentSchema) {
      const validation = currentSchema.safeParse(visibleFormData);
      if (!validation.success) {
        if (!isCurrentGeneration()) return;
        setErrors(validation.error);
        const firstIssue = validation.error.issues[0];
        if (firstIssue) toast.error(firstIssue.message);
        return;
      }
      setErrors(null);
    }

    saveSequenceRef.current += 1;
    const saveSequence = saveSequenceRef.current;
    const isCurrentSave = () => isCurrentGeneration() && saveSequenceRef.current === saveSequence;

    setSaving(true);
    try {
      if (!isCurrentSave()) return;
      const payload = toPayloadRef.current(visibleFormData);
      const currentCustomUpdate = customUpdateRef.current;
      let updateResult: DrawerUpdateResult<TResp> | void;

      if (currentCustomUpdate) {
        updateResult = await currentCustomUpdate({ entity: data, payload, endpoint, id });
      } else {
        const response = await api.put<TResp>(`${endpoint}/${id}`, payload);
        updateResult = { data: response.data };
      }
      if (!isCurrentSave()) return;

      if (updateResult?.data !== undefined) commitData(updateResult.data);
      toast.success(updateResult?.message ?? '更新成功');
      setMode('view');
      drawerStack.notifyEntityChanged(entityType);

      await refetch();
      if (!isCurrentSave()) return;
    } catch (err) {
      if (!isCurrentSave()) return;
      if (isAxiosError(err) && err.response?.status === 409) {
        toast.error('数据已被其他用户修改，已为您刷新最新版本');
        setMode('view');
        await refetch();
        if (!isCurrentSave()) return;
        return;
      }
      toast.error(getErrorMessage(err, '更新失败'));
    } finally {
      if (isCurrentSave()) setSaving(false);
    }
  }, [
    commitData,
    data,
    drawerStack,
    endpoint,
    entityType,
    id,
    isCurrentGeneration,
    refetch,
    visibleFormData,
  ]);

  const requestDelete = useCallback(() => {
    if (!isCurrentGeneration()) return;
    setDeleteOpen(true);
  }, [isCurrentGeneration]);

  const handleDeleteOpenChange = useCallback(
    (open: boolean) => {
      if (!isCurrentGeneration()) return;
      setDeleteOpen(open);
    },
    [isCurrentGeneration]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!isCurrentGeneration()) return;

    const version = getDeleteVersion(data);
    if (version === null) {
      toast.error(INVALID_DELETE_VERSION_TEXT);
      return;
    }

    deleteSequenceRef.current += 1;
    const deleteSequence = deleteSequenceRef.current;
    const isCurrentDelete = () =>
      isCurrentGeneration() && deleteSequenceRef.current === deleteSequence;

    setDeleting(true);
    try {
      if (!isCurrentDelete()) return;
      await api.delete(`${endpoint}/${id}?version=${version}`);
      if (!isCurrentDelete()) return;

      toast.success('删除成功');
      setDeleteOpen(false);
      drawerStack.notifyEntityChanged(entityType);
      drawerStack.pop();
    } catch (err) {
      if (!isCurrentDelete()) return;
      toast.error(getErrorMessage(err, '删除失败'));
    } finally {
      if (isCurrentDelete()) setDeleting(false);
    }
  }, [data, drawerStack, endpoint, entityType, id, isCurrentGeneration]);

  const entityName = data ? entityNameOf(data) : '';

  const deleteConfirmProps = useMemo(
    () => ({
      open: visibleDeleteOpen,
      onOpenChange: handleDeleteOpenChange,
      entityName,
      onConfirm: handleDeleteConfirm,
      loading: visibleDeleting,
    }),
    [entityName, handleDeleteConfirm, handleDeleteOpenChange, visibleDeleteOpen, visibleDeleting]
  );

  // 注册 close guard：edit + dirty 时弹原生 confirm 让用户确认放弃修改。
  useEffect(() => {
    if (!isCurrentGeneration() || visibleMode !== 'edit' || !isDirty) {
      setBeforeCloseGuard(null);
      return;
    }
    setBeforeCloseGuard(() => {
      if (!isCurrentGeneration()) return true;
      if (typeof window === 'undefined') return true;
      return window.confirm(DISCARD_CONFIRM_TEXT);
    });
    return () => setBeforeCloseGuard(null);
  }, [isCurrentGeneration, isDirty, setBeforeCloseGuard, visibleMode]);

  return {
    data,
    loading,
    error,
    refetch,
    mode: visibleMode,
    isDirty,
    formData: visibleFormData,
    updateFormField,
    getFieldError,
    enterEditMode,
    exitEditMode,
    handleSave,
    saving: visibleSaving,
    requestDelete,
    deleteConfirmProps,
  };
}
