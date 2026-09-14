import { queryFinancePnlDrilldownSchema, queryFinancePnlSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryFinancePnlDto extends createZodDto(queryFinancePnlSchema) {}
export class QueryFinancePnlDrilldownDto extends createZodDto(queryFinancePnlDrilldownSchema) {}
