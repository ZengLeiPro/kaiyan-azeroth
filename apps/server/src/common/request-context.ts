import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

export interface RequestDiagnosticContext {
  traceId: string;
  startedAt: number;
}

export type RequestWithDiagnosticContext = Request & {
  diagnosticContext?: RequestDiagnosticContext;
};

export function ensureRequestDiagnosticContext(
  request: RequestWithDiagnosticContext
): RequestDiagnosticContext {
  if (request.diagnosticContext) return request.diagnosticContext;

  // An arbitrary client can set x-request-id. Unless a trusted edge explicitly establishes
  // diagnosticContext in-process, generate our own ID and return it to the client for correlation.
  const context = {
    traceId: randomUUID(),
    startedAt: Date.now(),
  };
  request.diagnosticContext = context;
  return context;
}

export function requestDiagnosticContextMiddleware(
  request: RequestWithDiagnosticContext,
  response: Response,
  next: NextFunction
): void {
  const context = ensureRequestDiagnosticContext(request);
  response.setHeader('x-request-id', context.traceId);
  next();
}
