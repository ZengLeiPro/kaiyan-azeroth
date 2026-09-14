import { updateSystemParamSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 更新系统参数 DTO
 */
export class UpdateSystemParamDto extends createZodDto(updateSystemParamSchema) {}
