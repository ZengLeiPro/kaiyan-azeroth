import { updateProjectTicketSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateProjectTicketDto extends createZodDto(updateProjectTicketSchema) {}
