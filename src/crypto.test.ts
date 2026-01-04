/**
 * Tests for crypto.ts
 *
 * Uses Node 18+ Web Crypto API (same as Cloudflare Workers)
 */

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, encryptObject, decryptObject } from './crypto';
import { CryptoError } from './errors';

const TEST_KEY = 'test-encryption-key-32-bytes-ok!';

describe('crypto', () => {
  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt a simple string', async () => {
      const plaintext = 'Hello, World!';

      const encrypted = await encrypt(plaintext, TEST_KEY);
      const decrypted = await decrypt(encrypted, TEST_KEY);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt tokens with special characters', async () => {
      const token = 'ya29.a0ARrdaM-abc123_XYZ/+==';

      const encrypted = await encrypt(token, TEST_KEY);
      const decrypted = await decrypt(encrypted, TEST_KEY);

      expect(decrypted).toBe(token);
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const plaintext = 'same-token-value';

      const encrypted1 = await encrypt(plaintext, TEST_KEY);
      const encrypted2 = await encrypt(plaintext, TEST_KEY);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to same value
      expect(await decrypt(encrypted1, TEST_KEY)).toBe(plaintext);
      expect(await decrypt(encrypted2, TEST_KEY)).toBe(plaintext);
    });

    it('should handle empty string', async () => {
      const plaintext = '';

      const encrypted = await encrypt(plaintext, TEST_KEY);
      const decrypted = await decrypt(encrypted, TEST_KEY);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', async () => {
      const plaintext = 'a'.repeat(10000);

      const encrypted = await encrypt(plaintext, TEST_KEY);
      const decrypted = await decrypt(encrypted, TEST_KEY);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode strings', async () => {
      const plaintext = '日本語テスト 🚀 émojis';

      const encrypted = await encrypt(plaintext, TEST_KEY);
      const decrypted = await decrypt(encrypted, TEST_KEY);

      expect(decrypted).toBe(plaintext);
    });

    it('should fail with wrong decryption key', async () => {
      const plaintext = 'secret-data';
      const encrypted = await encrypt(plaintext, TEST_KEY);

      await expect(decrypt(encrypted, 'wrong-key-12345678901234567')).rejects.toThrow(
        CryptoError
      );
    });

    it('should fail with corrupted ciphertext', async () => {
      const plaintext = 'secret-data';
      const encrypted = await encrypt(plaintext, TEST_KEY);

      // Corrupt the ciphertext by changing a character
      const corrupted =
        encrypted.slice(0, 50) + 'X' + encrypted.slice(51);

      await expect(decrypt(corrupted, TEST_KEY)).rejects.toThrow(CryptoError);
    });

    it('should fail with truncated ciphertext', async () => {
      const plaintext = 'secret-data';
      const encrypted = await encrypt(plaintext, TEST_KEY);

      // Truncate the ciphertext
      const truncated = encrypted.slice(0, 20);

      await expect(decrypt(truncated, TEST_KEY)).rejects.toThrow(CryptoError);
    });

    it('should produce base64 output', async () => {
      const plaintext = 'test';
      const encrypted = await encrypt(plaintext, TEST_KEY);

      // Should be valid base64
      expect(() => atob(encrypted)).not.toThrow();
    });
  });

  describe('encryptObject/decryptObject', () => {
    it('should encrypt and decrypt objects', async () => {
      const obj = {
        accessToken: 'ya29.token',
        refreshToken: '1//refresh',
        expiresAt: 1234567890,
      };

      const encrypted = await encryptObject(obj, TEST_KEY);
      const decrypted = await decryptObject<typeof obj>(encrypted, TEST_KEY);

      expect(decrypted).toEqual(obj);
    });

    it('should handle nested objects', async () => {
      const obj = {
        user: {
          id: '123',
          tokens: {
            access: 'abc',
            refresh: 'xyz',
          },
        },
        metadata: {
          scopes: ['read', 'write'],
        },
      };

      const encrypted = await encryptObject(obj, TEST_KEY);
      const decrypted = await decryptObject<typeof obj>(encrypted, TEST_KEY);

      expect(decrypted).toEqual(obj);
    });

    it('should handle arrays', async () => {
      const arr = ['token1', 'token2', 'token3'];

      const encrypted = await encryptObject(arr, TEST_KEY);
      const decrypted = await decryptObject<typeof arr>(encrypted, TEST_KEY);

      expect(decrypted).toEqual(arr);
    });

    it('should handle null and undefined values', async () => {
      const obj = {
        present: 'value',
        missing: null,
        // undefined values are lost in JSON serialization
      };

      const encrypted = await encryptObject(obj, TEST_KEY);
      const decrypted = await decryptObject<typeof obj>(encrypted, TEST_KEY);

      expect(decrypted.present).toBe('value');
      expect(decrypted.missing).toBeNull();
    });
  });

  describe('key handling', () => {
    it('should work with short keys (PBKDF2 stretches them)', async () => {
      const shortKey = 'abc';
      const plaintext = 'test-data';

      const encrypted = await encrypt(plaintext, shortKey);
      const decrypted = await decrypt(encrypted, shortKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should work with long keys', async () => {
      const longKey = 'a'.repeat(1000);
      const plaintext = 'test-data';

      const encrypted = await encrypt(plaintext, longKey);
      const decrypted = await decrypt(encrypted, longKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different results with different keys', async () => {
      const plaintext = 'test-data';

      const encrypted1 = await encrypt(plaintext, 'key1-xxxxxxxxxxxxxx');
      const encrypted2 = await encrypt(plaintext, 'key2-xxxxxxxxxxxxxx');

      // Different keys should produce different ciphertext
      // (beyond just random IV differences, the actual encryption differs)
      expect(encrypted1).not.toBe(encrypted2);

      // Each should only decrypt with its own key
      expect(await decrypt(encrypted1, 'key1-xxxxxxxxxxxxxx')).toBe(plaintext);
      expect(await decrypt(encrypted2, 'key2-xxxxxxxxxxxxxx')).toBe(plaintext);
    });
  });
});
