import { publishHolidaysSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 整年发布节假日 DTO（前端把该年的全量「例外日期」一次提交，后端整年 diff）
 */
export class PublishHolidaysDto extends createZodDto(publishHolidaysSchema) {}
