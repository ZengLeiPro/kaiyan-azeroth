import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

type ZodDtoMetatype = { isZodDto: true };

function isZodDtoMetatype(metatype: unknown): metatype is ZodDtoMetatype {
  if (typeof metatype !== 'function') return false;
  if (!('isZodDto' in metatype)) return false;
  return (metatype as { isZodDto?: unknown }).isZodDto === true;
}

/**
 * 兼容遗留非 Zod 参数的 class-validator 管道。
 *
 * 业务 DTO 的主路径是 AppModule 中注册的 ZodValidationPipe；这里遇到 nestjs-zod
 * DTO 时必须直接跳过，避免 Zod DTO 被 class-validator 再处理一次。
 */
export class ClassValidatorValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata) {
    if (isZodDtoMetatype(metadata.metatype)) return value;
    return super.transform(value, metadata);
  }
}
