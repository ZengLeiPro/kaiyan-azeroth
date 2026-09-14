import { queryApprovalSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryApprovalDto extends createZodDto(queryApprovalSchema) {}
