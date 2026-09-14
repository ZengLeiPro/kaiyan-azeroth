import { archiveWebEventsSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class ArchiveWebEventsDto extends createZodDto(archiveWebEventsSchema) {}
