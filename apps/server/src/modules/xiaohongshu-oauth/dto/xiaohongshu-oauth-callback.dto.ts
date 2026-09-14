import { xiaohongshuOauthCallbackQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class XiaohongshuOauthCallbackDto extends createZodDto(
  xiaohongshuOauthCallbackQuerySchema
) {}
