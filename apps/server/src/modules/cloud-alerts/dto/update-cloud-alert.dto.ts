import { updateCloudAlertSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateCloudAlertDto extends createZodDto(updateCloudAlertSchema) {}
