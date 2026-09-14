import {
  holidayListResponseSchema,
  holidayResponseSchema,
  holidayYearResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class HolidayResponseDto extends createZodDto(holidayResponseSchema) {}

export class HolidayYearResponseDto extends createZodDto(holidayYearResponseSchema) {}

/**
 * 节假日列表分页响应（GET /holidays?year=xxx）
 * 整年作为单页返回，结构 = {items, total, page, pageSize, totalPages}
 */
export class HolidayListResponseDto extends createZodDto(holidayListResponseSchema) {}
