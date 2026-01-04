/**
 * Tests for provider implementations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleProvider } from './google';
import { MicrosoftProvider } from './microsoft';
import { GitHubProvider } from './github';
import type { ProviderConfig } from '../types';

const mockConfig: ProviderConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

describe('providers', () => {
  describe('GoogleProvider', () => {
    const provider = new GoogleProvider();

    it('should have correct id', () => {
      expect(provider.id).toBe('google');
    });

    it('should support refresh', () => {
      expect(provider.supportsRefresh).toBe(true);
    });

    it('should call Google token endpoint on refresh', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
      });

      // Replace global fetch
      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        const result = await provider.refresh('old-refresh-token', mockConfig);

        expect(mockFetch).toHaveBeenCalledWith(
          'https://oauth2.googleapis.com/token',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/x-www-form-urlencoded',
            }),
          })
        );

        expect(result).not.toBeNull();
        expect(result!.accessToken).toBe('new-access-token');
        expect(result!.refreshToken).toBe('new-refresh-token');
        expect(result!.expiresAt).toBeGreaterThan(Date.now());
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return null on refresh failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_grant' }),
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        const result = await provider.refresh('invalid-token', mockConfig);
        expect(result).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return null on network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        const result = await provider.refresh('token', mockConfig);
        expect(result).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('MicrosoftProvider', () => {
    const provider = new MicrosoftProvider();

    it('should have correct id', () => {
      expect(provider.id).toBe('microsoft');
    });

    it('should support refresh', () => {
      expect(provider.supportsRefresh).toBe(true);
    });

    it('should use common tenant by default', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-token',
            expires_in: 3600,
          }),
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        await provider.refresh('token', mockConfig);

        expect(mockFetch).toHaveBeenCalledWith(
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          expect.any(Object)
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should use custom tenant if provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-token',
            expires_in: 3600,
          }),
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        await provider.refresh('token', {
          ...mockConfig,
          tenantId: 'custom-tenant-id',
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'https://login.microsoftonline.com/custom-tenant-id/oauth2/v2.0/token',
          expect.any(Object)
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should handle token rotation (new refresh token)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access',
            refresh_token: 'rotated-refresh-token',
            expires_in: 3600,
          }),
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        const result = await provider.refresh('old-refresh', mockConfig);

        expect(result).not.toBeNull();
        expect(result!.refreshToken).toBe('rotated-refresh-token');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('GitHubProvider', () => {
    const provider = new GitHubProvider();

    it('should have correct id', () => {
      expect(provider.id).toBe('github');
    });

    it('should NOT support refresh', () => {
      expect(provider.supportsRefresh).toBe(false);
    });

    it('should return null on refresh (not supported)', async () => {
      const result = await provider.refresh('token', mockConfig);
      expect(result).toBeNull();
    });
  });

  describe('provider interface compliance', () => {
    const providers = [
      new GoogleProvider(),
      new MicrosoftProvider(),
      new GitHubProvider(),
    ];

    it('all providers should have unique ids', () => {
      const ids = providers.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('all providers should implement TokenProvider interface', () => {
      for (const provider of providers) {
        expect(typeof provider.id).toBe('string');
        expect(typeof provider.supportsRefresh).toBe('boolean');
        expect(typeof provider.refresh).toBe('function');
      }
    });
  });
});
