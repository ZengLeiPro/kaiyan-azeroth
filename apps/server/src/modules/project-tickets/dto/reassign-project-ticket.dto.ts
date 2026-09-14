import { reassignProjectTicketSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class ReassignProjectTicketDto extends createZodDto(reassignProjectTicketSchema) {}
