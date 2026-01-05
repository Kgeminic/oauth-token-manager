/**
 * Cloudflare KV Storage Adapter
 *
 * Key structure (multi-account support):
 * - tokens:{userId}:{provider}:{alias} → encrypted token data
 * - token-index:{userId} → JSON array of "provider:alias" strings (for listing)
 *
 * Backward compatibility:
 * - Missing alias defaults to 'default'
 * - Old keys (without alias) are migrated on access
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

const DEFAULT_ALIAS = 'default';

/**
 * Internal structure for encrypted storage
 * Only accessToken and refreshToken are encrypted
 * Metadata is stored in plaintext for auditability
 */
interface EncryptedStoredToken {
  userId: string;
  provider: string;
  /** Account alias for multi-account support */
  alias: string;
  /** Display name (e.g., email address) */
  displayName?: string;
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

  private tokenKey(userId: string, provider: string, alias: string = DEFAULT_ALIAS): string {
    return `${this.keyPrefix}:${userId}:${provider}:${alias}`;
  }

  private indexKey(userId: string): string {
    return `${INDEX_PREFIX}:${userId}`;
  }

  /**
   * Parse a provider:alias index entry
   */
  private parseIndexEntry(entry: string): { provider: string; alias: string } {
    const parts = entry.split(':');
    if (parts.length === 2) {
      return { provider: parts[0], alias: parts[1] };
    }
    // Backward compatibility: old entries without alias
    return { provider: entry, alias: DEFAULT_ALIAS };
  }

  /**
   * Create a provider:alias index entry
   */
  private indexEntry(provider: string, alias: string): string {
    return `${provider}:${alias}`;
  }

  async get(userId: string, provider: string, alias: string = DEFAULT_ALIAS): Promise<StoredToken | null> {
    try {
      const key = this.tokenKey(userId, provider, alias);
      const data = await this.kv.get<EncryptedStoredToken>(key, 'json');

      if (!data) {
        // Backward compatibility: try old key format (without alias) if looking for default
        if (alias === DEFAULT_ALIAS) {
          const oldKey = `${this.keyPrefix}:${userId}:${provider}`;
          const oldData = await this.kv.get<EncryptedStoredToken>(oldKey, 'json');
          if (oldData) {
            // Migrate to new format
            const migratedToken = { ...oldData, alias: DEFAULT_ALIAS };
            await this.kv.put(key, JSON.stringify(migratedToken));
            await this.kv.delete(oldKey);
            // Also update the index
            await this.migrateIndex(userId, provider);
            // Now decrypt and return
            return this.decryptToken(migratedToken);
          }
        }
        return null;
      }

      return this.decryptToken(data);
    } catch (error) {
      throw new StorageError('get', error instanceof Error ? error : undefined);
    }
  }

  /**
   * Decrypt a stored token
   */
  private async decryptToken(data: EncryptedStoredToken): Promise<StoredToken> {
    const accessToken = await decrypt(data.accessToken, this.encryptionKey);
    const refreshToken = data.refreshToken
      ? await decrypt(data.refreshToken, this.encryptionKey)
      : undefined;

    return {
      ...data,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Migrate old index entries (provider only) to new format (provider:alias)
   */
  private async migrateIndex(userId: string, provider: string): Promise<void> {
    const indexKey = this.indexKey(userId);
    const current = (await this.kv.get<string[]>(indexKey, 'json')) ?? [];

    // Check if old format exists
    const oldIndex = current.indexOf(provider);
    if (oldIndex !== -1) {
      // Replace with new format
      current[oldIndex] = this.indexEntry(provider, DEFAULT_ALIAS);
      await this.kv.put(indexKey, JSON.stringify(current));
    }
  }

  async set(token: StoredToken): Promise<void> {
    try {
      const alias = token.alias ?? DEFAULT_ALIAS;
      const key = this.tokenKey(token.userId, token.provider, alias);

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
        alias,
        displayName: token.displayName,
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
      await this.updateIndex(token.userId, token.provider, alias, 'add');
    } catch (error) {
      throw new StorageError('set', error instanceof Error ? error : undefined);
    }
  }

  async delete(userId: string, provider: string, alias: string = DEFAULT_ALIAS): Promise<void> {
    try {
      const key = this.tokenKey(userId, provider, alias);
      await this.kv.delete(key);
      await this.updateIndex(userId, provider, alias, 'remove');
    } catch (error) {
      throw new StorageError('delete', error instanceof Error ? error : undefined);
    }
  }

  async list(userId: string): Promise<ConnectedProvider[]> {
    try {
      const indexKey = this.indexKey(userId);
      const entries = await this.kv.get<string[]>(indexKey, 'json');

      if (!entries || entries.length === 0) {
        return [];
      }

      // Fetch each provider's token data
      const results: ConnectedProvider[] = [];

      for (const entry of entries) {
        const { provider, alias } = this.parseIndexEntry(entry);
        const token = await this.get(userId, provider, alias);
        if (token) {
          results.push({
            provider: token.provider,
            alias: token.alias ?? DEFAULT_ALIAS,
            displayName: token.displayName,
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
   * Update the provider:alias index for a user
   */
  private async updateIndex(
    userId: string,
    provider: string,
    alias: string,
    action: 'add' | 'remove'
  ): Promise<void> {
    const indexKey = this.indexKey(userId);
    const current = (await this.kv.get<string[]>(indexKey, 'json')) ?? [];
    const entry = this.indexEntry(provider, alias);

    let updated: string[];
    if (action === 'add') {
      if (!current.includes(entry)) {
        updated = [...current, entry];
      } else {
        return; // Already in index
      }
    } else {
      updated = current.filter((e) => e !== entry);
    }

    if (updated.length === 0) {
      await this.kv.delete(indexKey);
    } else {
      await this.kv.put(indexKey, JSON.stringify(updated));
    }
  }
}
