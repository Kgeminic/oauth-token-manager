/**
 * Cryptographic utilities for token encryption at rest
 *
 * Uses Web Crypto API (available in Cloudflare Workers, browsers, Node 18+)
 * Algorithm: AES-256-GCM (authenticated encryption)
 *
 * Security properties:
 * - Confidentiality: Tokens are encrypted and unreadable without the key
 * - Integrity: Tampering with ciphertext is detected (GCM auth tag)
 * - Key derivation: PBKDF2 derives strong key from your secret
 * - Random IVs: Same plaintext produces different ciphertext each time
 */

import { CryptoError } from './errors';

// AES-GCM parameters
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes (96 bits, recommended for GCM)
const SALT_LENGTH = 16; // bytes
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive a cryptographic key from a password/secret using PBKDF2
 */
async function deriveKey(
  secret: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Import the secret as a key for PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES key using PBKDF2
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext using AES-256-GCM
 *
 * Output format: base64(salt + iv + ciphertext + authTag)
 * - salt: 16 bytes (for key derivation)
 * - iv: 12 bytes (initialization vector)
 * - ciphertext: variable length
 * - authTag: 16 bytes (included in ciphertext by Web Crypto)
 *
 * @param plaintext - Data to encrypt
 * @param encryptionKey - Secret key/password for encryption
 * @returns Base64-encoded encrypted data
 */
export async function encrypt(
  plaintext: string,
  encryptionKey: string
): Promise<string> {
  try {
    // Generate random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    // Derive key from secret
    const key = await deriveKey(encryptionKey, salt);

    // Encrypt the data
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      encoded
    );

    // Combine salt + iv + ciphertext into single buffer
    const combined = new Uint8Array(
      salt.length + iv.length + ciphertext.byteLength
    );
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

    // Return as base64
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    throw new CryptoError('encrypt', error instanceof Error ? error : undefined);
  }
}

/**
 * Decrypt data encrypted with encrypt()
 *
 * @param encryptedData - Base64-encoded encrypted data
 * @param encryptionKey - Secret key/password used for encryption
 * @returns Decrypted plaintext
 */
export async function decrypt(
  encryptedData: string,
  encryptionKey: string
): Promise<string> {
  try {
    // Decode base64
    const combined = Uint8Array.from(atob(encryptedData), (c) =>
      c.charCodeAt(0)
    );

    // Extract salt, iv, and ciphertext
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

    // Derive key from secret
    const key = await deriveKey(encryptionKey, salt);

    // Decrypt the data
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new CryptoError('decrypt', error instanceof Error ? error : undefined);
  }
}

/**
 * Encrypt an object as JSON
 */
export async function encryptObject<T>(
  obj: T,
  encryptionKey: string
): Promise<string> {
  return encrypt(JSON.stringify(obj), encryptionKey);
}

/**
 * Decrypt JSON back to an object
 */
export async function decryptObject<T>(
  encryptedData: string,
  encryptionKey: string
): Promise<T> {
  const json = await decrypt(encryptedData, encryptionKey);
  return JSON.parse(json) as T;
}
