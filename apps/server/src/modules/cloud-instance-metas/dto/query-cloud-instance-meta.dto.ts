import { queryCloudInstanceMetaSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCloudInstanceMetaDto extends createZodDto(queryCloudInstanceMetaSchema) {}
