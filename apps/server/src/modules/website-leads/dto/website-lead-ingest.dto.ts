import { websiteLeadIngestSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class WebsiteLeadIngestDto extends createZodDto(websiteLeadIngestSchema) {}
