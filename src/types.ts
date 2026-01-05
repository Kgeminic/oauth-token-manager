/**
 * Core types for OAuth Token Manager
 */

/**
 * Stored token data (encrypted at rest)
 */
export interface StoredToken {
  /** User identifier from your auth system */
  userId: string;
  /** Provider identifier (e.g., 'google', 'microsoft', 'github') */
  provider: string;
  /** OAuth access token (encrypted) */
  accessToken: string;
  /** OAuth refresh token (encrypted, optional for providers like GitHub) */
  refreshToken?: string;
  /** Token expiration timestamp in milliseconds */
  expiresAt?: number;
  /** Scopes granted by the user */
  scopes: string[];
  /** When the token was first stored */
  createdAt: number;
  /** When the token was last updated */
  updatedAt: number;
}

/**
 * Token data returned to consumers (decrypted)
 */
export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
}

/**
 * Options for storing a new token
 */
export interface StoreTokenOptions {
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
}

/**
 * Options for retrieving a token
 */
export interface GetTokenOptions {
  userId: string;
  provider: string;
  /** If specified, verify these scopes are present */
  requiredScopes?: string[];
  /** Buffer time in ms before expiry to trigger refresh (default: 5 minutes) */
  refreshBuffer?: number;
}

/**
 * Options for listing a user's connected providers
 */
export interface ListTokensOptions {
  userId: string;
}

/**
 * Summary of a connected provider
 */
export interface ConnectedProvider {
  provider: string;
  scopes: string[];
  connectedAt: number;
  expiresAt?: number;
}

/**
 * Options for revoking a token
 */
export interface RevokeTokenOptions {
  userId: string;
  provider: string;
}

/**
 * Provider configuration for token refresh
 */
export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  /** Microsoft-specific: tenant ID (default: 'common') */
  tenantId?: string;
}

/**
 * Token manager configuration
 */
export interface TokenManagerConfig {
  /** Storage adapter (KV or D1) */
  storage: TokenStorage;
  /** @deprecated Encryption is handled by the storage adapter. This field is unused. */
  encryptionKey?: string;
  /** Provider configurations for token refresh */
  providers: {
    google?: ProviderConfig;
    microsoft?: ProviderConfig;
    github?: ProviderConfig;
    [key: string]: ProviderConfig | undefined;
  };
  /** Default buffer time before expiry to trigger refresh (default: 5 minutes) */
  defaultRefreshBuffer?: number;
}

/**
 * Storage adapter interface
 * Implement this for custom storage backends
 */
export interface TokenStorage {
  /**
   * Get a stored token by user and provider
   */
  get(userId: string, provider: string): Promise<StoredToken | null>;

  /**
   * Store or update a token
   */
  set(token: StoredToken): Promise<void>;

  /**
   * Delete a token
   */
  delete(userId: string, provider: string): Promise<void>;

  /**
   * List all providers for a user
   */
  list(userId: string): Promise<ConnectedProvider[]>;
}

/**
 * Provider interface for token refresh
 */
export interface TokenProvider {
  /** Provider identifier */
  readonly id: string;

  /**
   * Refresh an expired access token
   *
   * @returns
   * - RefreshResult: New token data on success
   * - RefreshFailure: Token was permanently revoked (auto-cleanup recommended)
   * - throws Error: Temporary failure (network, rate limit) - retry later
   */
  refresh(
    refreshToken: string,
    config: ProviderConfig
  ): Promise<RefreshResult | RefreshFailure>;

  /**
   * Whether this provider supports token refresh
   * (GitHub tokens don't expire, so no refresh needed)
   */
  readonly supportsRefresh: boolean;
}

/**
 * Result of a token refresh operation
 */
export interface RefreshResult {
  accessToken: string;
  /** New refresh token (some providers rotate) */
  refreshToken?: string;
  /** New expiration time */
  expiresAt?: number;
}

/**
 * Result when token refresh fails
 */
export interface RefreshFailure {
  /** Token was permanently invalidated (revoked by user/admin) - should delete from storage */
  revoked: true;
  /** Error code from provider (e.g., 'invalid_grant') */
  errorCode?: string;
  /** Human-readable error message */
  errorMessage?: string;
}
