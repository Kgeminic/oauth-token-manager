/**
 * Custom error types for OAuth Token Manager
 *
 * These errors provide clear, actionable information about what went wrong
 * and what the application should do to recover.
 */

/**
 * Base error class for all token manager errors
 */
export class TokenManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'TokenManagerError';
  }
}

/**
 * Token not found for the given user and provider
 *
 * Recovery: Redirect user to OAuth flow to connect this provider
 */
export class TokenNotFoundError extends TokenManagerError {
  constructor(
    public readonly userId: string,
    public readonly provider: string
  ) {
    super(
      `No token found for user "${userId}" and provider "${provider}". User needs to connect this provider.`,
      'TOKEN_NOT_FOUND'
    );
    this.name = 'TokenNotFoundError';
  }
}

/**
 * Token has expired and refresh failed or no refresh token available
 *
 * Recovery: Redirect user to OAuth flow to re-authenticate
 */
export class TokenExpiredError extends TokenManagerError {
  constructor(
    public readonly userId: string,
    public readonly provider: string,
    public readonly reason: 'no_refresh_token' | 'refresh_failed' | 'refresh_token_expired'
  ) {
    const reasons = {
      no_refresh_token: 'No refresh token available',
      refresh_failed: 'Token refresh request failed',
      refresh_token_expired: 'Refresh token has expired',
    };
    super(
      `Token expired for user "${userId}" and provider "${provider}". ${reasons[reason]}. User needs to re-authenticate.`,
      'TOKEN_EXPIRED'
    );
    this.name = 'TokenExpiredError';
  }
}

/**
 * Token exists but doesn't have the required scopes
 *
 * Recovery: Redirect user to OAuth flow with incremental consent for missing scopes
 */
export class InsufficientScopesError extends TokenManagerError {
  constructor(
    public readonly userId: string,
    public readonly provider: string,
    public readonly requiredScopes: string[],
    public readonly grantedScopes: string[]
  ) {
    const missing = requiredScopes.filter((s) => !grantedScopes.includes(s));
    super(
      `Token for user "${userId}" and provider "${provider}" is missing required scopes: ${missing.join(', ')}. User needs to grant additional permissions.`,
      'INSUFFICIENT_SCOPES'
    );
    this.name = 'InsufficientScopesError';
  }

  get missingScopes(): string[] {
    return this.requiredScopes.filter((s) => !this.grantedScopes.includes(s));
  }
}

/**
 * Provider is not configured in the token manager
 *
 * Recovery: Add provider configuration to TokenManager constructor
 */
export class ProviderNotConfiguredError extends TokenManagerError {
  constructor(public readonly provider: string) {
    super(
      `Provider "${provider}" is not configured. Add it to the TokenManager providers config.`,
      'PROVIDER_NOT_CONFIGURED'
    );
    this.name = 'ProviderNotConfiguredError';
  }
}

/**
 * Encryption/decryption failed
 *
 * Recovery: Check encryption key is correct and hasn't changed
 */
export class CryptoError extends TokenManagerError {
  constructor(
    operation: 'encrypt' | 'decrypt',
    public readonly cause?: Error
  ) {
    super(
      `Failed to ${operation} token data. This may indicate a corrupted token or incorrect encryption key.`,
      'CRYPTO_ERROR'
    );
    this.name = 'CryptoError';
  }
}

/**
 * Storage operation failed
 *
 * Recovery: Check storage backend (KV/D1) is available and configured correctly
 */
export class StorageError extends TokenManagerError {
  constructor(
    operation: 'get' | 'set' | 'delete' | 'list',
    public readonly cause?: Error
  ) {
    super(
      `Storage operation "${operation}" failed. Check your storage backend configuration.`,
      'STORAGE_ERROR'
    );
    this.name = 'StorageError';
  }
}
