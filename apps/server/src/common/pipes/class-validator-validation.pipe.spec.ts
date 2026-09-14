import { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ClassValidatorValidationPipe } from './class-validator-validation.pipe';

class LegacyDto {
  name!: string;
}

class ZodLikeDto {
  static isZodDto = true;
}

describe('ClassValidatorValidationPipe', () => {
  it('遇到 nestjs-zod DTO 时直接跳过，避免 class-validator 二次处理', async () => {
    const pipe = new ClassValidatorValidationPipe({ whitelist: true });
    const value = { extra: 'kept-for-zod-pipe' };

    await expect(
      pipe.transform(value, { metatype: ZodLikeDto, type: 'body' } as ArgumentMetadata)
    ).resolves.toBe(value);
  }, 30_000);

  it('非 Zod DTO 继续走 Nest ValidationPipe 原逻辑', async () => {
    const pipe = new ClassValidatorValidationPipe({ transform: true });

    const result = await pipe.transform({ name: 'Alice' }, {
      metatype: LegacyDto,
      type: 'body',
    } as ArgumentMetadata);

    expect(result).toBeInstanceOf(LegacyDto);
  });
});
