import { z } from 'zod';

export const xiaohongshuOauthCallbackQuerySchema = z
  .object({
    auth_code: z.string().trim().min(1).max(4096).optional(),
    state: z.string().trim().max(1024).optional(),
  })
  .passthrough();

export type XiaohongshuOauthCallbackQuery = z.infer<typeof xiaohongshuOauthCallbackQuerySchema>;
