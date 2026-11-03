import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

export interface InboundEventPayload {
  messageId: string;
  senderPhone: string;
  type: 'text' | 'audio';
  text?: string;
  mediaUrl?: string;
  timestamp: number;
}

@Injectable()
export class VexelLockService implements OnModuleDestroy {
  public readonly redis: Redis;

  // Lua: Atomically fetch all buffered messages and delete the buffer key
  private readonly flushBufferLua = `
    local items = redis.call("LRANGE", KEYS[1], 0, -1)
    if #items > 0 then
      redis.call("DEL", KEYS[1])
    end
    return items
  `;

  // Lua: Release lock ONLY if lockToken matches current owner
  private readonly releaseLockLua = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  // Lua: Extend lock TTL ONLY if lockToken matches current owner
  private readonly extendLockLua = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }

  /**
   * Returns true if this exact webhook event hasn't been seen in the last 24h
   */
  async claimIdempotencyKey(tenantId: string, eventHash: string): Promise<boolean> {
    const key = `vexel:dedup:${tenantId}:${eventHash}`;
    const res = await this.redis.set(key, '1', 'EX', 86400, 'NX');
    return res === 'OK';
  }

  /**
   * Appends a message to the sender's sliding-window buffer
   */
  async appendToBuffer(tenantId: string, senderPhone: string, payload: InboundEventPayload): Promise<number> {
    const bufferKey = `vexel:buf:${tenantId}:${senderPhone}`;
    const count = await this.redis.rpush(bufferKey, JSON.stringify(payload));
    // Safety TTL of 1 hour in case a worker queue is paused
    await this.redis.expire(bufferKey, 3600);
    return count;
  }

  /**
   * Atomically drains all buffered messages for a sender
   */
  async flushBuffer(tenantId: string, senderPhone: string): Promise<InboundEventPayload[]> {
    const bufferKey = `vexel:buf:${tenantId}:${senderPhone}`;
    const rawItems = (await this.redis.eval(this.flushBufferLua, 1, bufferKey)) as string[];
    return rawItems.map((item) => JSON.parse(item) as InboundEventPayload);
  }

  /**
   * Acquires an exclusive lock on a sender/deal for `ttlMs` milliseconds
   */
  async acquireDealLock(tenantId: string, entityKey: string, ttlMs = 45000): Promise<string | null> {
    const lockKey = `vexel:lock:${tenantId}:${entityKey}`;
    const lockToken = randomUUID();
    const acquired = await this.redis.set(lockKey, lockToken, 'PX', ttlMs, 'NX');
    return acquired === 'OK' ? lockToken : null;
  }

  async extendDealLock(tenantId: string, entityKey: string, lockToken: string, ttlMs = 45000): Promise<boolean> {
    const lockKey = `vexel:lock:${tenantId}:${entityKey}`;
    const res = await this.redis.eval(this.extendLockLua, 1, lockKey, lockToken, ttlMs.toString());
    return res === 1;
  }

  async releaseDealLock(tenantId: string, entityKey: string, lockToken: string): Promise<void> {
    const lockKey = `vexel:lock:${tenantId}:${entityKey}`;
    await this.redis.eval(this.releaseLockLua, 1, lockKey, lockToken);
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}