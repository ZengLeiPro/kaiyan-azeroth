let tokenRotationTail: Promise<void> = Promise.resolve();
const TOKEN_ROTATION_LOCK = 'ky-azeroth-auth-token-rotation';

async function withCrossTabLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return operation();
  return navigator.locks.request(TOKEN_ROTATION_LOCK, { mode: 'exclusive' }, operation);
}

/**
 * refresh 与 reauthenticate 都会轮换同一 refresh token。
 * Web Locks 负责跨标签页互斥，本地 Promise 队列负责同一标签页的确定顺序。
 * 取得跨页锁后先从持久化存储重新水合，才能识别其他标签页刚提交的新 token 代际。
 */
export function serializeTokenRotation<T>(
  operation: () => Promise<T>,
  beforeOperation?: () => void | Promise<void>
): Promise<T> {
  const run = () =>
    withCrossTabLock(async () => {
      await beforeOperation?.();
      return operation();
    });
  const result = tokenRotationTail.then(run, run);
  tokenRotationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
