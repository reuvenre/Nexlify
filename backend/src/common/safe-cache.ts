import { Cache } from 'cache-manager';

/**
 * Cache access that can NEVER hang the request.
 *
 * When REDIS_URL points at a dead/unreachable Redis, every cacheManager.get()
 * blocks on the connection attempt — which froze ALL endpoints that touch the
 * exchange-rate/category cache (the entire products area) while DB-only
 * endpoints stayed fine. A cache must be an accelerator, not a dependency:
 * if it doesn't answer fast, skip it and fetch from the source.
 */
const CACHE_TIMEOUT_MS = 1200;

export async function cacheGet<T>(cache: Cache, key: string): Promise<T | undefined> {
  try {
    return await Promise.race([
      cache.get<T>(key) as Promise<T | undefined>,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), CACHE_TIMEOUT_MS)),
    ]);
  } catch {
    return undefined;
  }
}

export async function cacheSet(cache: Cache, key: string, value: unknown, ttlMs?: number): Promise<void> {
  try {
    await Promise.race([
      cache.set(key, value, ttlMs) as Promise<unknown>,
      new Promise<void>((resolve) => setTimeout(resolve, CACHE_TIMEOUT_MS)),
    ]);
  } catch {
    /* cache write failures are never fatal */
  }
}
