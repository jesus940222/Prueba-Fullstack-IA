import { Redis } from "ioredis";
import type { PermissionCache, RateLimiter } from "../../application/ports";

export function createRedisGuards(url: string): { rates: RateLimiter; cache: PermissionCache; close: () => void } {
  const redis = new Redis(url, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: false });
  redis.on("error", () => undefined);
  return {
    rates: {
      async hit(key, limit, windowSeconds) {
        try {
          const count = await redis.incr(key);
          if (count === 1) {
            await redis.expire(key, windowSeconds);
          }
          return count > limit ? "limited" : "ok";
        } catch {
          return "unavailable";
        }
      },
    },
    cache: {
      async get(key) {
        try {
          const value = await redis.get(`perm:${key}`);
          return value === null ? null : (JSON.parse(value) as string[]);
        } catch {
          return null;
        }
      },
      async set(key, permissions, ttlSeconds) {
        try {
          await redis.set(`perm:${key}`, JSON.stringify(permissions), "EX", ttlSeconds);
        } catch {
          return undefined;
        }
      },
    },
    close: () => {
      redis.disconnect();
    },
  };
}
