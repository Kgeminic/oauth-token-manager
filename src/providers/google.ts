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

import type { TokenProvider, ProviderConfig, RefreshResult } from '../types';

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

/**
 * Google OAuth token provider
 */
export class GoogleProvider implements TokenProvider {
  readonly id = 'google';
  readonly supportsRefresh = true;

  async refresh(
    refreshToken: string,
    config: ProviderConfig
  ): Promise<RefreshResult | null> {
    try {
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

        // Check for specific errors that indicate re-auth is needed
        if (
          error.error === 'invalid_grant' ||
          error.error === 'unauthorized_client'
        ) {
          // Refresh token is invalid/revoked - user needs to re-authenticate
          return null;
        }

        // Other errors - throw to retry later
        throw new Error(`Token refresh failed: ${error.error}`);
      }

      const data = (await response.json()) as GoogleTokenResponse;

      return {
        accessToken: data.access_token,
        // Google may return a new refresh token (rare, but handle it)
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
    } catch (error) {
      console.error('[GoogleProvider] Refresh error:', error);
      // Network errors or unexpected issues - return null to trigger re-auth
      return null;
    }
  }
}

/**
 * Default Google provider instance
 */
export const googleProvider = new GoogleProvider();
