/**
 * Tests for TokenManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager } from './token-manager';
import type {
  TokenStorage,
  StoredToken,
  ConnectedProvider,
  ProviderConfig,
  TokenProvider,
} from './types';
import {
  TokenNotFoundError,
  TokenExpiredError,
  InsufficientScopesError,
  ProviderNotConfiguredError,
} from './errors';

// Mock storage implementation
function createMockStorage(): TokenStorage & {
  _tokens: Map<string, StoredToken>;
} {
  const tokens = new Map<string, StoredToken>();

  return {
    _tokens: tokens,

    get: vi.fn(async (userId: string, provider: string) => {
      return tokens.get(`${userId}:${provider}`) ?? null;
    }),

    set: vi.fn(async (token: StoredToken) => {
      tokens.set(`${token.userId}:${token.provider}`, token);
    }),

    delete: vi.fn(async (userId: string, provider: string) => {
      tokens.delete(`${userId}:${provider}`);
    }),

    list: vi.fn(async (userId: string): Promise<ConnectedProvider[]> => {
      const result: ConnectedProvider[] = [];
      for (const [key, token] of tokens) {
        if (key.startsWith(`${userId}:`)) {
          result.push({
            provider: token.provider,
            scopes: token.scopes,
            connectedAt: token.createdAt,
            expiresAt: token.expiresAt,
          });
        }
      }
      return result;
    }),
  };
}

// Mock provider config
const mockProviderConfig: ProviderConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

describe('TokenManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let tokenManager: TokenManager;

  beforeEach(() => {
    storage = createMockStorage();
    tokenManager = new TokenManager({
      storage,
      providers: {
        google: mockProviderConfig,
        microsoft: mockProviderConfig,
        github: mockProviderConfig,
      },
    });
  });

  describe('store', () => {
    it('should store a new token', async () => {
      await tokenManager.store({
        userId: 'user-123',
        provider: 'google',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['calendar.read'],
      });

      expect(storage.set).toHaveBeenCalled();

      const stored = storage._tokens.get('user-123:google');
      expect(stored).toBeDefined();
      expect(stored!.accessToken).toBe('access-token');
      expect(stored!.refreshToken).toBe('refresh-token');
    });

    it('should preserve createdAt on update', async () => {
      const originalCreatedAt = Date.now() - 86400000; // 1 day ago

      // Simulate existing token
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'old-token',
        scopes: ['calendar.read'],
        createdAt: originalCreatedAt,
        updatedAt: originalCreatedAt,
      });

      // Update token
      await tokenManager.store({
        userId: 'user-123',
        provider: 'google',
        accessToken: 'new-token',
        scopes: ['calendar.read'],
      });

      const stored = storage._tokens.get('user-123:google');
      expect(stored!.createdAt).toBe(originalCreatedAt);
      expect(stored!.accessToken).toBe('new-token');
    });
  });

  describe('get', () => {
    it('should return valid token', async () => {
      // Store a valid token (not expired)
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'valid-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        scopes: ['calendar.read'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = await tokenManager.get({
        userId: 'user-123',
        provider: 'google',
      });

      expect(result.accessToken).toBe('valid-access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });

    it('should throw TokenNotFoundError for missing token', async () => {
      await expect(
        tokenManager.get({ userId: 'user-999', provider: 'google' })
      ).rejects.toThrow(TokenNotFoundError);
    });

    it('should validate required scopes', async () => {
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: ['email', 'profile'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Request with scopes that exist
      await expect(
        tokenManager.get({
          userId: 'user-123',
          provider: 'google',
          requiredScopes: ['email'],
        })
      ).resolves.toBeDefined();

      // Request with missing scopes
      await expect(
        tokenManager.get({
          userId: 'user-123',
          provider: 'google',
          requiredScopes: ['calendar.read'],
        })
      ).rejects.toThrow(InsufficientScopesError);
    });

    it('should throw InsufficientScopesError with correct missing scopes', async () => {
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: ['email'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      try {
        await tokenManager.get({
          userId: 'user-123',
          provider: 'google',
          requiredScopes: ['email', 'calendar.read', 'calendar.write'],
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientScopesError);
        const scopeError = error as InsufficientScopesError;
        expect(scopeError.missingScopes).toEqual([
          'calendar.read',
          'calendar.write',
        ]);
      }
    });

    it('should return token without refresh if not expired', async () => {
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await tokenManager.get({ userId: 'user-123', provider: 'google' });

      // Storage.set should not be called (no refresh happened)
      expect(storage.set).toHaveBeenCalledTimes(0);
    });
  });

  describe('list', () => {
    it('should list all providers for a user', async () => {
      const now = Date.now();

      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token1',
        scopes: ['calendar.read'],
        createdAt: now,
        updatedAt: now,
      });

      storage._tokens.set('user-123:microsoft', {
        userId: 'user-123',
        provider: 'microsoft',
        accessToken: 'token2',
        scopes: ['mail.read'],
        createdAt: now,
        updatedAt: now,
      });

      const providers = await tokenManager.list({ userId: 'user-123' });

      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.provider).sort()).toEqual([
        'google',
        'microsoft',
      ]);
    });

    it('should return empty array for user with no tokens', async () => {
      const providers = await tokenManager.list({ userId: 'user-999' });
      expect(providers).toEqual([]);
    });
  });

  describe('revoke', () => {
    it('should delete the token', async () => {
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await tokenManager.revoke({ userId: 'user-123', provider: 'google' });

      expect(storage.delete).toHaveBeenCalledWith('user-123', 'google');
      expect(storage._tokens.has('user-123:google')).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true if token exists', async () => {
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = await tokenManager.has('user-123', 'google');
      expect(result).toBe(true);
    });

    it('should return false if token does not exist', async () => {
      const result = await tokenManager.has('user-999', 'google');
      expect(result).toBe(false);
    });
  });

  describe('token refresh', () => {
    it('should throw TokenExpiredError if no refresh token', async () => {
      // Store expired token without refresh token
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000, // Already expired
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await expect(
        tokenManager.get({ userId: 'user-123', provider: 'google' })
      ).rejects.toThrow(TokenExpiredError);

      try {
        await tokenManager.get({ userId: 'user-123', provider: 'google' });
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExpiredError);
        expect((error as TokenExpiredError).reason).toBe('no_refresh_token');
      }
    });

    it('should throw ProviderNotConfiguredError for unconfigured provider', async () => {
      // Create manager without xero config
      const limitedManager = new TokenManager({
        storage,
        providers: { google: mockProviderConfig },
      });

      storage._tokens.set('user-123:xero', {
        userId: 'user-123',
        provider: 'xero',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000, // Already expired
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await expect(
        limitedManager.get({ userId: 'user-123', provider: 'xero' })
      ).rejects.toThrow(ProviderNotConfiguredError);
    });
  });

  describe('registerProvider', () => {
    it('should allow registering custom providers', () => {
      const customProvider: TokenProvider = {
        id: 'custom',
        supportsRefresh: true,
        refresh: vi.fn(),
      };

      TokenManager.registerProvider(customProvider);

      // The provider should now be available (tested indirectly through refresh)
      // This is a static method so it affects all instances
    });
  });

  describe('refresh buffer', () => {
    it('should use default refresh buffer', async () => {
      // Token expiring in 4 minutes (less than default 5 min buffer)
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Should try to refresh since within buffer
      // (Will fail because we're not mocking the provider, but the attempt is the test)
      try {
        await tokenManager.get({ userId: 'user-123', provider: 'google' });
      } catch (error) {
        // Expected to fail refresh, but should have attempted
        expect(error).toBeInstanceOf(TokenExpiredError);
      }
    });

    it('should respect custom refresh buffer', async () => {
      const customManager = new TokenManager({
        storage,
        providers: { google: mockProviderConfig },
        defaultRefreshBuffer: 10 * 60 * 1000, // 10 minutes
      });

      // Token expiring in 8 minutes
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 8 * 60 * 1000, // 8 minutes
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // With 10 min buffer, 8 min should trigger refresh
      try {
        await customManager.get({ userId: 'user-123', provider: 'google' });
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExpiredError);
      }
    });

    it('should allow per-request refresh buffer override', async () => {
      // Token expiring in 8 minutes
      storage._tokens.set('user-123:google', {
        userId: 'user-123',
        provider: 'google',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 8 * 60 * 1000, // 8 minutes
        scopes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // With 5 min default buffer, 8 min should NOT trigger refresh
      const result = await tokenManager.get({
        userId: 'user-123',
        provider: 'google',
        refreshBuffer: 5 * 60 * 1000, // 5 min buffer
      });

      expect(result.accessToken).toBe('token');

      // But with 10 min buffer, it should try to refresh
      try {
        await tokenManager.get({
          userId: 'user-123',
          provider: 'google',
          refreshBuffer: 10 * 60 * 1000, // 10 min buffer
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExpiredError);
      }
    });
  });
});
