import { queryCloudAlertSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCloudAlertDto extends createZodDto(queryCloudAlertSchema) {}
