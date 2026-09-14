import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHttpStatus, parseRetryAfterMs, validateApiBaseUrl } from '../../client.js';
import { CLI_EXIT_CODES, CliError } from '../../utils.js';
import {
  computeRetryWaitMs,
  MAX_SINGLE_RETRY_WAIT_MS,
  MAX_TOTAL_RETRY_WAIT_MS,
  reserveRetryWaitMs,
} from '../all-pages.js';

test('API base URL allows loopback HTTP but rejects non-loopback plaintext and ambiguous URLs', () => {
  for (const accepted of [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://127.255.10.20:3000',
    'http://[::1]:3000',
    'https://api.example.com',
    'https://fc.example.com/ky-azeroth',
  ]) {
    assert.doesNotThrow(() => validateApiBaseUrl(accepted), accepted);
  }
  assert.equal(
    validateApiBaseUrl('https://fc.example.com/ky-azeroth/'),
    'https://fc.example.com/ky-azeroth'
  );

  for (const rejected of [
    'http://api.example.com',
    'http://192.168.1.10:3000',
    'https://api.example.com/api/v1',
    'https://fc.example.com/ky-azeroth/api/v1',
    'https://user:pass@example.com',
    'https://api.example.com?token=x',
    'ftp://example.com',
  ]) {
    assert.throws(
      () => validateApiBaseUrl(rejected),
      (error: unknown) => error instanceof CliError && error.exitCode === CLI_EXIT_CODES.USAGE,
      rejected
    );
  }
});

test('HTTP status classification retries network and temporary failures only', () => {
  const cases = [
    [400, 'VALIDATION', false, CLI_EXIT_CODES.USAGE],
    [401, 'AUTHENTICATION', false, CLI_EXIT_CODES.AUTH],
    [403, 'PERMISSION_DENIED', false, CLI_EXIT_CODES.PERMISSION],
    [404, 'NOT_FOUND', false, CLI_EXIT_CODES.NOT_FOUND],
    [409, 'CONFLICT', false, CLI_EXIT_CODES.CONFLICT],
    [429, 'RATE_LIMITED', true, CLI_EXIT_CODES.TEMPORARY],
    [503, 'TEMPORARY_FAILURE', true, CLI_EXIT_CODES.TEMPORARY],
  ] as const;
  assert.deepEqual(classifyHttpStatus(undefined), {
    code: 'NETWORK_ERROR',
    retryable: true,
    exitCode: CLI_EXIT_CODES.TEMPORARY,
    message: 'Network request failed',
  });

  for (const [status, code, retryable, exitCode] of cases) {
    assert.deepEqual(classifyHttpStatus(status), {
      code,
      retryable,
      exitCode,
      message:
        status === 400
          ? 'Validation error'
          : status === 401
            ? 'Authentication failed'
            : status === 403
              ? 'Permission denied'
              : status === 404
                ? 'Not found'
                : status === 409
                  ? 'Conflict'
                  : status === 429
                    ? 'Rate limited'
                    : `Temporary API failure (${status})`,
    });
  }
});

test('Retry-After supports delta seconds and HTTP-date without accepting junk', () => {
  const now = Date.parse('2026-08-24T12:00:00Z');
  assert.equal(parseRetryAfterMs('15', now), 15_000);
  assert.equal(parseRetryAfterMs('Mon, 24 Aug 2026 12:00:20 GMT', now), 20_000);
  assert.equal(parseRetryAfterMs('not-a-date', now), undefined);
  assert.equal(parseRetryAfterMs(undefined, now), undefined);
});

test('--all retry wait applies bounded jitter and rejects single/cumulative budget overflow', () => {
  assert.equal(
    computeRetryWaitMs(500, undefined, 0, () => 1),
    550
  );
  assert.equal(
    computeRetryWaitMs(500, undefined, 0, () => 99),
    550
  );
  assert.equal(
    computeRetryWaitMs(500, 15_000, 0, () => 0),
    15_000
  );
  assert.equal(
    computeRetryWaitMs(500, MAX_SINGLE_RETRY_WAIT_MS + 1, 0, () => 0),
    null
  );
  assert.equal(
    computeRetryWaitMs(500, 15_000, MAX_TOTAL_RETRY_WAIT_MS - 10_000, () => 0),
    null
  );
});

test('--all shares Retry-After budget across pages and rejects a second 60s wait', () => {
  const budget = { totalWaitMs: 0 };
  assert.equal(
    reserveRetryWaitMs(500, 60_000, budget, () => 0),
    60_000
  );
  assert.equal(budget.totalWaitMs, 60_000);

  // Models page N succeeding after its retry and page N+1 returning Retry-After: 60.
  assert.equal(
    reserveRetryWaitMs(500, 60_000, budget, () => 0),
    null
  );
  assert.equal(budget.totalWaitMs, 60_000);
});

test('--all shared Retry-After budget accepts the exact 90s cumulative boundary', () => {
  const budget = { totalWaitMs: 0 };
  assert.equal(
    reserveRetryWaitMs(500, 60_000, budget, () => 0),
    60_000
  );
  assert.equal(
    reserveRetryWaitMs(500, 30_000, budget, () => 0),
    30_000
  );
  assert.equal(budget.totalWaitMs, MAX_TOTAL_RETRY_WAIT_MS);
});
