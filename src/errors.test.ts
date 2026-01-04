/**
 * Tests for errors.ts
 */

import { describe, it, expect } from 'vitest';
import {
  TokenManagerError,
  TokenNotFoundError,
  TokenExpiredError,
  InsufficientScopesError,
  ProviderNotConfiguredError,
  CryptoError,
  StorageError,
} from './errors';

describe('errors', () => {
  describe('TokenManagerError', () => {
    it('should be an instance of Error', () => {
      const error = new TokenManagerError('test message', 'TEST_CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TokenManagerError);
    });

    it('should have message and code', () => {
      const error = new TokenManagerError('test message', 'TEST_CODE');
      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('TokenManagerError');
    });
  });

  describe('TokenNotFoundError', () => {
    it('should include userId and provider', () => {
      const error = new TokenNotFoundError('user-123', 'google');
      expect(error.userId).toBe('user-123');
      expect(error.provider).toBe('google');
      expect(error.code).toBe('TOKEN_NOT_FOUND');
      expect(error.name).toBe('TokenNotFoundError');
    });

    it('should have descriptive message', () => {
      const error = new TokenNotFoundError('user-123', 'google');
      expect(error.message).toContain('user-123');
      expect(error.message).toContain('google');
      expect(error.message).toContain('connect this provider');
    });
  });

  describe('TokenExpiredError', () => {
    it('should include userId, provider, and reason', () => {
      const error = new TokenExpiredError('user-123', 'google', 'refresh_failed');
      expect(error.userId).toBe('user-123');
      expect(error.provider).toBe('google');
      expect(error.reason).toBe('refresh_failed');
      expect(error.code).toBe('TOKEN_EXPIRED');
      expect(error.name).toBe('TokenExpiredError');
    });

    it('should have different messages for different reasons', () => {
      const noRefresh = new TokenExpiredError('u', 'p', 'no_refresh_token');
      const failed = new TokenExpiredError('u', 'p', 'refresh_failed');
      const expired = new TokenExpiredError('u', 'p', 'refresh_token_expired');

      expect(noRefresh.message).toContain('No refresh token');
      expect(failed.message).toContain('refresh request failed');
      expect(expired.message).toContain('Refresh token has expired');
    });
  });

  describe('InsufficientScopesError', () => {
    it('should include all scope information', () => {
      const error = new InsufficientScopesError(
        'user-123',
        'google',
        ['calendar.read', 'calendar.write', 'email'],
        ['email']
      );

      expect(error.userId).toBe('user-123');
      expect(error.provider).toBe('google');
      expect(error.requiredScopes).toEqual(['calendar.read', 'calendar.write', 'email']);
      expect(error.grantedScopes).toEqual(['email']);
      expect(error.code).toBe('INSUFFICIENT_SCOPES');
      expect(error.name).toBe('InsufficientScopesError');
    });

    it('should calculate missing scopes', () => {
      const error = new InsufficientScopesError(
        'user-123',
        'google',
        ['calendar.read', 'calendar.write', 'email'],
        ['email']
      );

      expect(error.missingScopes).toEqual(['calendar.read', 'calendar.write']);
    });

    it('should have descriptive message with missing scopes', () => {
      const error = new InsufficientScopesError(
        'user-123',
        'google',
        ['calendar.read', 'email'],
        ['email']
      );

      expect(error.message).toContain('calendar.read');
      expect(error.message).toContain('grant additional permissions');
    });
  });

  describe('ProviderNotConfiguredError', () => {
    it('should include provider name', () => {
      const error = new ProviderNotConfiguredError('xero');
      expect(error.provider).toBe('xero');
      expect(error.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(error.name).toBe('ProviderNotConfiguredError');
    });

    it('should have helpful message', () => {
      const error = new ProviderNotConfiguredError('xero');
      expect(error.message).toContain('xero');
      expect(error.message).toContain('not configured');
    });
  });

  describe('CryptoError', () => {
    it('should include operation type', () => {
      const encryptError = new CryptoError('encrypt');
      const decryptError = new CryptoError('decrypt');

      expect(encryptError.message).toContain('encrypt');
      expect(decryptError.message).toContain('decrypt');
      expect(encryptError.code).toBe('CRYPTO_ERROR');
      expect(encryptError.name).toBe('CryptoError');
    });

    it('should include cause if provided', () => {
      const cause = new Error('underlying error');
      const error = new CryptoError('decrypt', cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('StorageError', () => {
    it('should include operation type', () => {
      const error = new StorageError('get');
      expect(error.message).toContain('get');
      expect(error.code).toBe('STORAGE_ERROR');
      expect(error.name).toBe('StorageError');
    });

    it('should handle all operation types', () => {
      const operations = ['get', 'set', 'delete', 'list'] as const;

      for (const op of operations) {
        const error = new StorageError(op);
        expect(error.message).toContain(op);
      }
    });

    it('should include cause if provided', () => {
      const cause = new Error('KV unavailable');
      const error = new StorageError('set', cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('error inheritance', () => {
    it('all errors should be catchable as TokenManagerError', () => {
      const errors = [
        new TokenNotFoundError('u', 'p'),
        new TokenExpiredError('u', 'p', 'refresh_failed'),
        new InsufficientScopesError('u', 'p', [], []),
        new ProviderNotConfiguredError('p'),
        new CryptoError('encrypt'),
        new StorageError('get'),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(TokenManagerError);
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
