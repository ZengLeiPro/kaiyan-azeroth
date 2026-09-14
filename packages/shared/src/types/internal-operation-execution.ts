/**
 * 常驻内部运维入口的幂等执行记录。
 *
 * 仅用于后端运维审计，不代表可由普通业务 API 访问。
 */
export interface IInternalOperationExecution {
  id: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  status: string;
  resultJson: unknown;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}
