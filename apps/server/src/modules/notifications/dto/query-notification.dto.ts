import { queryNotificationSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryNotificationDto extends createZodDto(queryNotificationSchema) {}
