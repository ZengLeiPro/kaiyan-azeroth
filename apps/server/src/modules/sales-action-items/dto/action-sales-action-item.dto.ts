import {
  doneSalesActionItemSchema,
  ignoreSalesActionItemSchema,
  transferSalesActionItemSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/** 忽略待办入参（resolveNote 必填，D7 可审计） */
export class IgnoreSalesActionItemDto extends createZodDto(ignoreSalesActionItemSchema) {}

/** 办结待办入参（doneType + resolveNote 必填；跟进情况可带 keepRecord） */
export class DoneSalesActionItemDto extends createZodDto(doneSalesActionItemSchema) {}

/** 转交待办入参（targetEmployeeId + reason 必填） */
export class TransferSalesActionItemDto extends createZodDto(transferSalesActionItemSchema) {}
