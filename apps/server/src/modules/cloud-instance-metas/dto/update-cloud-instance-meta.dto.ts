import { updateCloudInstanceMetaSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateCloudInstanceMetaDto extends createZodDto(updateCloudInstanceMetaSchema) {}
