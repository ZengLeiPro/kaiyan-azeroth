import { createProjectTicketSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateProjectTicketDto extends createZodDto(createProjectTicketSchema) {}
