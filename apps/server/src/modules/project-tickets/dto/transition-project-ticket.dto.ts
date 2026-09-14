import { transitionProjectTicketSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class TransitionProjectTicketDto extends createZodDto(transitionProjectTicketSchema) {}
