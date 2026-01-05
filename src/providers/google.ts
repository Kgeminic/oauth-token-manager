/**
 * Google OAuth Provider
 *
 * Token characteristics:
 * - Access token lifetime: ~1 hour
 * - Refresh token: Does not expire (unless revoked)
 * - Token rotation: Optional (configurable in Google Cloud Console)
 *
 * Requires `access_type=offline` during initial OAuth to get refresh token
 */

import type { TokenProvider, ProviderConfig, RefreshResult, RefreshFailure } from '../types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string; // Only returned if Google rotates the refresh token
}

interface GoogleErrorResponse {
  error: string;
  error_description?: string;
}

/** Google error codes that indicate permanent token revocation */
const REVOCATION_ERRORS = ['invalid_grant', 'unauthorized_client'];

/**
 * Google OAuth token provider
 */
export class GoogleProvider implements TokenProvider {
  readonly id = 'google';
  readonly supportsRefresh = true;

  async refresh(
    refreshToken: string,
    config: ProviderConfig
  ): Promise<RefreshResult | RefreshFailure> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const error = (await response.json()) as GoogleErrorResponse;
      console.error(
        `[GoogleProvider] Token refresh failed: ${error.error} - ${error.error_description}`
      );

      // Check for permanent revocation errors
      if (REVOCATION_ERRORS.includes(error.error)) {
        return {
          revoked: true,
          errorCode: error.error,
          errorMessage: error.error_description,
        };
      }

      // Other errors (rate limit, server error) - throw for retry
      throw new Error(`Token refresh failed: ${error.error} - ${error.error_description || ''}`);
    }

    const data = (await response.json()) as GoogleTokenResponse;

    return {
      accessToken: data.access_token,
      // Google may return a new refresh token (rare, but handle it)
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}

/**
 * Default Google provider instance
 */
export const googleProvider = new GoogleProvider();
