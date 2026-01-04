/**
 * OAuth Token Manager
 *
 * Main entry point for storing, retrieving, and refreshing OAuth tokens
 * for downstream API access in Cloudflare Workers.
 */

import type {
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
} from './types';

import {
  TokenNotFoundError,
  TokenExpiredError,
  InsufficientScopesError,
  ProviderNotConfiguredError,
} from './errors';

import { GoogleProvider } from './providers/google';
import { MicrosoftProvider } from './providers/microsoft';
import { GitHubProvider } from './providers/github';

// Default refresh buffer: 5 minutes before expiry
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Built-in provider instances
 */
const builtInProviders: Record<string, TokenProvider> = {
  google: new GoogleProvider(),
  microsoft: new MicrosoftProvider(),
  github: new GitHubProvider(),
};

/**
 * OAuth Token Manager
 *
 * Manages OAuth tokens for downstream API access:
 * - Stores tokens encrypted at rest
 * - Automatically refreshes expired tokens
 * - Validates required scopes
 * - Supports Google, Microsoft, and GitHub out of the box
 *
 * @example
 * ```typescript
 * const tokens = new TokenManager({
 *   storage: new KVStorage({ namespace: env.TOKEN_KV, encryptionKey: env.TOKEN_KEY }),
 *   encryptionKey: env.TOKEN_KEY,
 *   providers: {
 *     google: {
 *       clientId: env.GOOGLE_CLIENT_ID,
 *       clientSecret: env.GOOGLE_CLIENT_SECRET,
 *     },
 *   },
 * });
 *
 * // Store token after OAuth callback
 * await tokens.store({ userId, provider: 'google', accessToken, refreshToken, expiresAt, scopes });
 *
 * // Get valid token (auto-refreshes if needed)
 * const { accessToken } = await tokens.get({ userId, provider: 'google' });
 * ```
 */
export class TokenManager {
  private readonly storage: TokenStorage;
  private readonly providers: Map<string, ProviderConfig>;
  private readonly defaultRefreshBuffer: number;

  constructor(config: TokenManagerConfig) {
    this.storage = config.storage;
    this.providers = new Map(Object.entries(config.providers).filter(([, v]) => v !== undefined) as [string, ProviderConfig][]);
    this.defaultRefreshBuffer = config.defaultRefreshBuffer ?? DEFAULT_REFRESH_BUFFER_MS;
  }

  /**
   * Store a new token or update an existing one
   *
   * Call this after a successful OAuth callback to store the user's tokens.
   */
  async store(options: StoreTokenOptions): Promise<void> {
    const now = Date.now();

    // Check if token already exists (update vs create)
    const existing = await this.storage.get(options.userId, options.provider);

    const token: StoredToken = {
      userId: options.userId,
      provider: options.provider,
      accessToken: options.accessToken,
      refreshToken: options.refreshToken,
      expiresAt: options.expiresAt,
      scopes: options.scopes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.storage.set(token);
  }

  /**
   * Get a valid access token for API calls
   *
   * - Returns the current token if still valid
   * - Automatically refreshes if expired or expiring soon
   * - Validates required scopes if specified
   *
   * @throws TokenNotFoundError - User hasn't connected this provider
   * @throws TokenExpiredError - Token expired and refresh failed
   * @throws InsufficientScopesError - Token missing required scopes
   * @throws ProviderNotConfiguredError - Provider not in config (for refresh)
   */
  async get(options: GetTokenOptions): Promise<TokenData> {
    const { userId, provider, requiredScopes, refreshBuffer } = options;

    // Fetch stored token
    const stored = await this.storage.get(userId, provider);

    if (!stored) {
      throw new TokenNotFoundError(userId, provider);
    }

    // Check required scopes
    if (requiredScopes && requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every((scope) =>
        stored.scopes.includes(scope)
      );
      if (!hasAllScopes) {
        throw new InsufficientScopesError(
          userId,
          provider,
          requiredScopes,
          stored.scopes
        );
      }
    }

    // Check if token needs refresh
    const bufferMs = refreshBuffer ?? this.defaultRefreshBuffer;
    const needsRefresh =
      stored.expiresAt && Date.now() + bufferMs >= stored.expiresAt;

    if (needsRefresh) {
      return await this.refreshToken(stored);
    }

    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      scopes: stored.scopes,
    };
  }

  /**
   * List all connected providers for a user
   */
  async list(options: ListTokensOptions): Promise<ConnectedProvider[]> {
    return this.storage.list(options.userId);
  }

  /**
   * Revoke/delete a token
   *
   * Note: This only removes the token from storage. For providers that
   * support token revocation (e.g., GitHub), you may want to also call
   * the provider's revocation endpoint.
   */
  async revoke(options: RevokeTokenOptions): Promise<void> {
    await this.storage.delete(options.userId, options.provider);
  }

  /**
   * Check if a user has a token for a provider (without retrieving it)
   */
  async has(userId: string, provider: string): Promise<boolean> {
    const token = await this.storage.get(userId, provider);
    return token !== null;
  }

  /**
   * Refresh an expired token
   */
  private async refreshToken(stored: StoredToken): Promise<TokenData> {
    const { userId, provider, refreshToken } = stored;

    // Check for refresh token
    if (!refreshToken) {
      throw new TokenExpiredError(userId, provider, 'no_refresh_token');
    }

    // Get provider config
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new ProviderNotConfiguredError(provider);
    }

    // Get provider implementation
    const providerImpl = builtInProviders[provider];
    if (!providerImpl) {
      // For custom providers without built-in implementation,
      // we can't refresh - user needs to re-authenticate
      throw new TokenExpiredError(userId, provider, 'refresh_failed');
    }

    // Check if provider supports refresh
    if (!providerImpl.supportsRefresh) {
      // Provider tokens don't expire (e.g., GitHub)
      // If we got here, the token must be invalid
      throw new TokenExpiredError(userId, provider, 'refresh_failed');
    }

    // Attempt refresh
    const refreshed = await providerImpl.refresh(refreshToken, providerConfig);

    if (!refreshed) {
      throw new TokenExpiredError(userId, provider, 'refresh_failed');
    }

    // Update stored token with new values
    const updatedToken: StoredToken = {
      ...stored,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      expiresAt: refreshed.expiresAt,
      updatedAt: Date.now(),
    };

    await this.storage.set(updatedToken);

    return {
      accessToken: updatedToken.accessToken,
      refreshToken: updatedToken.refreshToken,
      expiresAt: updatedToken.expiresAt,
      scopes: updatedToken.scopes,
    };
  }

  /**
   * Register a custom provider implementation
   *
   * Use this to add support for providers beyond Google/Microsoft/GitHub
   */
  static registerProvider(provider: TokenProvider): void {
    builtInProviders[provider.id] = provider;
  }
}
