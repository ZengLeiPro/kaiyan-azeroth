import { addProjectMemberSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class AddProjectMemberDto extends createZodDto(addProjectMemberSchema) {}
