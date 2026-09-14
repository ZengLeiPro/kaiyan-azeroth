import { ForbiddenException } from '@nestjs/common';

import {
  assertFreshJwtAuthentication,
  FRESH_JWT_AUTHENTICATION_FUTURE_SKEW_MS,
  FRESH_JWT_AUTHENTICATION_MAX_AGE_MS,
} from './fresh-jwt-authentication';

const now = new Date('2026-08-25T00:00:00.000Z');

function jwtAt(authenticatedAt: Date) {
  return { authType: 'jwt' as const, authenticatedAt };
}

describe('assertFreshJwtAuthentication', () => {
  it('accepts the exact five-minute boundary', () => {
    expect(() =>
      assertFreshJwtAuthentication(
        jwtAt(new Date(now.getTime() - FRESH_JWT_AUTHENTICATION_MAX_AGE_MS)),
        now
      )
    ).not.toThrow();
  });

  it('rejects a JWT older than five minutes', () => {
    expect(() =>
      assertFreshJwtAuthentication(
        jwtAt(new Date(now.getTime() - FRESH_JWT_AUTHENTICATION_MAX_AGE_MS - 1)),
        now
      )
    ).toThrow(ForbiddenException);
  });

  it('allows bounded clock skew and rejects authentication times beyond it', () => {
    expect(() =>
      assertFreshJwtAuthentication(
        jwtAt(new Date(now.getTime() + FRESH_JWT_AUTHENTICATION_FUTURE_SKEW_MS)),
        now
      )
    ).not.toThrow();
    expect(() =>
      assertFreshJwtAuthentication(
        jwtAt(new Date(now.getTime() + FRESH_JWT_AUTHENTICATION_FUTURE_SKEW_MS + 1)),
        now
      )
    ).toThrow(ForbiddenException);
    expect(() => assertFreshJwtAuthentication({ authType: 'jwt' }, now)).toThrow(
      ForbiddenException
    );
  });

  it('rejects PAT authentication regardless of age', () => {
    expect(() =>
      assertFreshJwtAuthentication({ authType: 'pat', authenticatedAt: now }, now)
    ).toThrow(ForbiddenException);
  });
});
