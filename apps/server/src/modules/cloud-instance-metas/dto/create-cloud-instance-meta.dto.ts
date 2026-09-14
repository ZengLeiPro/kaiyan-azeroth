import { createCloudInstanceMetaSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateCloudInstanceMetaDto extends createZodDto(createCloudInstanceMetaSchema) {}
