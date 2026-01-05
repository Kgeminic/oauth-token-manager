/**
 * @jezweb/oauth-token-manager
 *
 * OAuth token management for Cloudflare Workers.
 * Store, refresh, and retrieve tokens for downstream API access.
 *
 * @example
 * ```typescript
 * import { TokenManager } from '@jezweb/oauth-token-manager';
 * import { KVStorage } from '@jezweb/oauth-token-manager/storage/kv';
 *
 * const tokens = new TokenManager({
 *   storage: new KVStorage({
 *     namespace: env.TOKEN_KV,
 *     encryptionKey: env.TOKEN_ENCRYPTION_KEY,
 *   }),
 *   encryptionKey: env.TOKEN_ENCRYPTION_KEY,
 *   providers: {
 *     google: {
 *       clientId: env.GOOGLE_CLIENT_ID,
 *       clientSecret: env.GOOGLE_CLIENT_SECRET,
 *     },
 *   },
 * });
 *
 * // Store token after OAuth callback
 * await tokens.store({
 *   userId: 'user-123',
 *   provider: 'google',
 *   accessToken: '...',
 *   refreshToken: '...',
 *   expiresAt: Date.now() + 3600000,
 *   scopes: ['calendar', 'drive'],
 * });
 *
 * // Get valid token (auto-refreshes if expired)
 * const { accessToken } = await tokens.get({
 *   userId: 'user-123',
 *   provider: 'google',
 *   requiredScopes: ['calendar'],
 * });
 * ```
 *
 * @packageDocumentation
 */

// Main class
export { TokenManager } from './token-manager';

// Types
export type {
  TokenManagerConfig,
  TokenStorage,
  TokenProvider,
  ProviderConfig,
  StoredToken,
  TokenData,
  StoreTokenOptions,
  GetTokenOptions,
  ListTokensOptions,
  ConnectedProvider,
  RevokeTokenOptions,
  RefreshResult,
  RefreshFailure,
} from './types';

// Errors
export {
  TokenManagerError,
  TokenNotFoundError,
  TokenExpiredError,
  TokenRevokedError,
  InsufficientScopesError,
  ProviderNotConfiguredError,
  CryptoError,
  StorageError,
} from './errors';

// Crypto utilities (for advanced usage)
export { encrypt, decrypt, encryptObject, decryptObject } from './crypto';

// Storage adapters (re-exported for convenience)
export { KVStorage, type KVStorageOptions } from './storage/kv';

// Provider implementations (for extension)
export { GoogleProvider, googleProvider } from './providers/google';
export { MicrosoftProvider, microsoftProvider } from './providers/microsoft';
export {
  GitHubProvider,
  githubProvider,
  revokeGitHubToken,
} from './providers/github';
