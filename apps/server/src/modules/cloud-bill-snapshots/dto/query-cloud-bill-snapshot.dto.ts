import { queryCloudBillSnapshotSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCloudBillSnapshotDto extends createZodDto(queryCloudBillSnapshotSchema) {}
