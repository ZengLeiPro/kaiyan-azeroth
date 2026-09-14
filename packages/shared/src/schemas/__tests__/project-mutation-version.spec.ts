import { describe, expect, it } from 'vitest';

import { effortRecordResponseSchema, updateEffortRecordSchema } from '../effort-record';
import { projectMemberSchema, projectResponseSchema, updateProjectSchema } from '../project';
import {
  projectTicketResponseSchema,
  reassignProjectTicketSchema,
  transitionProjectTicketSchema,
  updateProjectTicketSchema,
} from '../project-ticket';

const updateSchemas = [
  updateProjectSchema,
  updateProjectTicketSchema,
  updateEffortRecordSchema,
  reassignProjectTicketSchema,
  transitionProjectTicketSchema,
] as const;

describe('项目域写操作 version 契约', () => {
  it.each(updateSchemas)('更新、改派与流转拒绝缺失或非法 version', (schema) => {
    const versionSchema = schema.shape.version;
    expect(versionSchema.safeParse(undefined).success).toBe(false);
    expect(versionSchema.safeParse(0).success).toBe(false);
    expect(versionSchema.safeParse(1.5).success).toBe(false);
    expect(versionSchema.safeParse(2).success).toBe(true);
  });

  it('项目域响应 schema 强制返回正整数 version', () => {
    for (const schema of [
      projectResponseSchema,
      projectMemberSchema,
      projectTicketResponseSchema,
      effortRecordResponseSchema,
    ]) {
      const versionSchema = schema.shape.version;
      expect(versionSchema.safeParse(undefined).success).toBe(false);
      expect(versionSchema.safeParse(0).success).toBe(false);
      expect(versionSchema.safeParse(2).success).toBe(true);
    }
  });
});
