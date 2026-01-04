/**
 * Tests for KV storage adapter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KVStorage } from './kv';
import type { StoredToken } from '../types';

// Mock KVNamespace
function createMockKV() {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = store.get(key);
      if (!value) return null;
      if (type === 'json') return JSON.parse(value);
      return value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    // Additional methods to inspect state
    _store: store,
    _clear: () => store.clear(),
  } as unknown as KVNamespace & {
    _store: Map<string, string>;
    _clear: () => void;
  };
}

const TEST_KEY = 'test-encryption-key-32-bytes-ok!';

describe('KVStorage', () => {
  let kv: ReturnType<typeof createMockKV>;
  let storage: KVStorage;

  beforeEach(() => {
    kv = createMockKV();
    storage = new KVStorage({
      namespace: kv,
      encryptionKey: TEST_KEY,
    });
  });

  describe('set', () => {
    it('should store a token', async () => {
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'ya29.access-token',
        refreshToken: '1//refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['calendar.read'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);

      // Should have called put
      expect(kv.put).toHaveBeenCalled();

      // Key should be formatted correctly
      const putCall = vi.mocked(kv.put).mock.calls[0];
      expect(putCall[0]).toBe('tokens:user-123:google');
    });

    it('should encrypt tokens before storage', async () => {
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'SECRET_ACCESS_TOKEN',
        refreshToken: 'SECRET_REFRESH_TOKEN',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);

      // Get what was stored
      const storedValue = kv._store.get('tokens:user-123:google');
      expect(storedValue).toBeDefined();

      // Parse it to check structure
      const parsed = JSON.parse(storedValue!);

      // Access token should be encrypted (not plaintext)
      expect(parsed.accessToken).not.toBe('SECRET_ACCESS_TOKEN');
      expect(parsed.accessToken).not.toContain('SECRET');

      // Refresh token should be encrypted too
      expect(parsed.refreshToken).not.toBe('SECRET_REFRESH_TOKEN');

      // Non-sensitive fields should be plaintext
      expect(parsed.userId).toBe('user-123');
      expect(parsed.provider).toBe('google');
    });

    it('should update the provider index', async () => {
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);

      // Check index was created
      const indexValue = kv._store.get('token-index:user-123');
      expect(indexValue).toBeDefined();
      expect(JSON.parse(indexValue!)).toContain('google');
    });

    it('should not duplicate provider in index', async () => {
      // Store same provider twice
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token1',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);
      await storage.set({ ...token, accessToken: 'token2' });

      // Index should only have one entry
      const indexValue = kv._store.get('token-index:user-123');
      const index = JSON.parse(indexValue!);
      expect(index.filter((p: string) => p === 'google')).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('should retrieve and decrypt a stored token', async () => {
      const originalToken: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'ya29.access-token',
        refreshToken: '1//refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['calendar.read', 'calendar.write'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(originalToken);
      const retrieved = await storage.get('user-123', 'google');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.accessToken).toBe('ya29.access-token');
      expect(retrieved!.refreshToken).toBe('1//refresh-token');
      expect(retrieved!.scopes).toEqual(['calendar.read', 'calendar.write']);
    });

    it('should return null for non-existent token', async () => {
      const result = await storage.get('user-999', 'google');
      expect(result).toBeNull();
    });

    it('should handle token without refresh token', async () => {
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'github',
        accessToken: 'ghp_xxx',
        scopes: ['repo'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);
      const retrieved = await storage.get('user-123', 'github');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.accessToken).toBe('ghp_xxx');
      expect(retrieved!.refreshToken).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete a token', async () => {
      // Store a token first
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);

      // Verify it exists
      expect(await storage.get('user-123', 'google')).not.toBeNull();

      // Delete it
      await storage.delete('user-123', 'google');

      // Should be gone
      expect(await storage.get('user-123', 'google')).toBeNull();
    });

    it('should update the index when deleting', async () => {
      // Store two providers
      const googleToken: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token1',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const msToken: StoredToken = {
        userId: 'user-123',
        provider: 'microsoft',
        accessToken: 'token2',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(googleToken);
      await storage.set(msToken);

      // Delete google
      await storage.delete('user-123', 'google');

      // Index should only have microsoft
      const indexValue = kv._store.get('token-index:user-123');
      const index = JSON.parse(indexValue!);
      expect(index).not.toContain('google');
      expect(index).toContain('microsoft');
    });

    it('should delete index when last provider removed', async () => {
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);
      await storage.delete('user-123', 'google');

      // Index should be deleted
      expect(kv._store.has('token-index:user-123')).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all providers for a user', async () => {
      // Store multiple providers
      const now = Date.now();
      const tokens: StoredToken[] = [
        {
          userId: 'user-123',
          provider: 'google',
          accessToken: 'token1',
          scopes: ['calendar.read'],
          expiresAt: now + 3600000,
          createdAt: now - 86400000, // 1 day ago
          updatedAt: now,
        },
        {
          userId: 'user-123',
          provider: 'microsoft',
          accessToken: 'token2',
          scopes: ['mail.read'],
          expiresAt: now + 7200000,
          createdAt: now - 172800000, // 2 days ago
          updatedAt: now,
        },
      ];

      for (const token of tokens) {
        await storage.set(token);
      }

      const providers = await storage.list('user-123');

      expect(providers).toHaveLength(2);

      const google = providers.find((p) => p.provider === 'google');
      expect(google).toBeDefined();
      expect(google!.scopes).toEqual(['calendar.read']);
      expect(google!.expiresAt).toBe(now + 3600000);

      const microsoft = providers.find((p) => p.provider === 'microsoft');
      expect(microsoft).toBeDefined();
      expect(microsoft!.scopes).toEqual(['mail.read']);
    });

    it('should return empty array for user with no tokens', async () => {
      const providers = await storage.list('user-999');
      expect(providers).toEqual([]);
    });

    it('should handle deleted tokens gracefully', async () => {
      // Store a token
      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.set(token);

      // Manually delete the token but not the index (simulating inconsistency)
      kv._store.delete('tokens:user-123:google');

      // List should handle missing token gracefully
      const providers = await storage.list('user-123');
      expect(providers).toEqual([]);
    });
  });

  describe('custom key prefix', () => {
    it('should use custom prefix for keys', async () => {
      const customStorage = new KVStorage({
        namespace: kv,
        encryptionKey: TEST_KEY,
        keyPrefix: 'custom-prefix',
      });

      const token: StoredToken = {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await customStorage.set(token);

      // Should use custom prefix
      expect(kv._store.has('custom-prefix:user-123:google')).toBe(true);
      expect(kv._store.has('tokens:user-123:google')).toBe(false);
    });
  });
});
