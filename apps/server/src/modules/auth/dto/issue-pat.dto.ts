import { issuePatSchema } from '@ky-azeroth/shared/schemas/auth';
import { createZodDto } from 'nestjs-zod';

export class IssuePatDto extends createZodDto(issuePatSchema) {}
