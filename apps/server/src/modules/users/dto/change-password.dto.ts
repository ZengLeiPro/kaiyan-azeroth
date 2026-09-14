import { changePasswordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 修改密码 DTO
 * Schema 从 shared 导入，确保前后端验证规则一致
 */
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
