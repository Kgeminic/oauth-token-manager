/**
 * Cloudflare KV Storage Adapter
 *
 * Key structure:
 * - tokens:{userId}:{provider} → encrypted token data
 * - token-index:{userId} → JSON array of provider IDs (for listing)
 *
 * Note: KV is eventually consistent. For strict consistency needs, use D1 adapter.
 */

import type {
  TokenStorage,
  StoredToken,
  ConnectedProvider,
} from '../types';
import { StorageError } from '../errors';
import { encrypt, decrypt } from '../crypto';

const KEY_PREFIX = 'tokens';
const INDEX_PREFIX = 'token-index';

/**
 * Internal structure for encrypted storage
 * Only accessToken and refreshToken are encrypted
 * Metadata is stored in plaintext for auditability
 */
interface EncryptedStoredToken {
  userId: string;
  provider: string;
  /** Encrypted access token */
  accessToken: string;
  /** Encrypted refresh token (if present) */
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KVStorageOptions {
  /** Cloudflare KV Namespace binding */
  namespace: KVNamespace;
  /** Encryption key for token data */
  encryptionKey: string;
  /** Optional key prefix (default: 'tokens') */
  keyPrefix?: string;
}

/**
 * KV Storage adapter for Cloudflare Workers KV
 */
export class KVStorage implements TokenStorage {
  private readonly kv: KVNamespace;
  private readonly encryptionKey: string;
  private readonly keyPrefix: string;

  constructor(options: KVStorageOptions) {
    this.kv = options.namespace;
    this.encryptionKey = options.encryptionKey;
    this.keyPrefix = options.keyPrefix ?? KEY_PREFIX;
  }

  private tokenKey(userId: string, provider: string): string {
    return `${this.keyPrefix}:${userId}:${provider}`;
  }

  private indexKey(userId: string): string {
    return `${INDEX_PREFIX}:${userId}`;
  }

  async get(userId: string, provider: string): Promise<StoredToken | null> {
    try {
      const key = this.tokenKey(userId, provider);
      const data = await this.kv.get<EncryptedStoredToken>(key, 'json');

      if (!data) {
        return null;
      }

      // Decrypt sensitive fields
      const accessToken = await decrypt(data.accessToken, this.encryptionKey);
      const refreshToken = data.refreshToken
        ? await decrypt(data.refreshToken, this.encryptionKey)
        : undefined;

      return {
        ...data,
        accessToken,
        refreshToken,
      };
    } catch (error) {
      throw new StorageError('get', error instanceof Error ? error : undefined);
    }
  }

  async set(token: StoredToken): Promise<void> {
    try {
      const key = this.tokenKey(token.userId, token.provider);

      // Encrypt sensitive fields
      const encryptedAccessToken = await encrypt(
        token.accessToken,
        this.encryptionKey
      );
      const encryptedRefreshToken = token.refreshToken
        ? await encrypt(token.refreshToken, this.encryptionKey)
        : undefined;

      const data: EncryptedStoredToken = {
        userId: token.userId,
        provider: token.provider,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
      };

      // Store the token
      await this.kv.put(key, JSON.stringify(data));

      // Update the index
      await this.updateIndex(token.userId, token.provider, 'add');
    } catch (error) {
      throw new StorageError('set', error instanceof Error ? error : undefined);
    }
  }

  async delete(userId: string, provider: string): Promise<void> {
    try {
      const key = this.tokenKey(userId, provider);
      await this.kv.delete(key);
      await this.updateIndex(userId, provider, 'remove');
    } catch (error) {
      throw new StorageError('delete', error instanceof Error ? error : undefined);
    }
  }

  async list(userId: string): Promise<ConnectedProvider[]> {
    try {
      const indexKey = this.indexKey(userId);
      const providers = await this.kv.get<string[]>(indexKey, 'json');

      if (!providers || providers.length === 0) {
        return [];
      }

      // Fetch each provider's token data
      const results: ConnectedProvider[] = [];

      for (const provider of providers) {
        const token = await this.get(userId, provider);
        if (token) {
          results.push({
            provider: token.provider,
            scopes: token.scopes,
            connectedAt: token.createdAt,
            expiresAt: token.expiresAt,
          });
        }
      }

      return results;
    } catch (error) {
      throw new StorageError('list', error instanceof Error ? error : undefined);
    }
  }

  /**
   * Update the provider index for a user
   */
  private async updateIndex(
    userId: string,
    provider: string,
    action: 'add' | 'remove'
  ): Promise<void> {
    const indexKey = this.indexKey(userId);
    const current = (await this.kv.get<string[]>(indexKey, 'json')) ?? [];

    let updated: string[];
    if (action === 'add') {
      if (!current.includes(provider)) {
        updated = [...current, provider];
      } else {
        return; // Already in index
      }
    } else {
      updated = current.filter((p) => p !== provider);
    }

    if (updated.length === 0) {
      await this.kv.delete(indexKey);
    } else {
      await this.kv.put(indexKey, JSON.stringify(updated));
    }
  }
}
