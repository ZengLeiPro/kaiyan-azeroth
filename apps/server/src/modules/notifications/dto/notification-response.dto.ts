import { notificationResponseSchema } from '@ky-azeroth/shared/schemas';
import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class NotificationResponseDto extends createZodDto(notificationResponseSchema) {}

export class NotificationListResponseDto extends createZodDto(
  createPaginatedResponseSchema(notificationResponseSchema)
) {}
