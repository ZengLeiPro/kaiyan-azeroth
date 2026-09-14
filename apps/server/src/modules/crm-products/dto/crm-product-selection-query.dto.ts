import { crmProductSelectionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * CRM 产品选择器查询 DTO（用于下拉框）
 * @description 使用 Shared Zod Schema 确保前后端验证一致
 */
export class CrmProductSelectionQueryDto extends createZodDto(crmProductSelectionQuerySchema) {}
