import { querySeoTrafficSnapshotSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoTrafficSnapshotDto extends createZodDto(querySeoTrafficSnapshotSchema) {}
