/**
 * Microsoft OAuth Provider (Azure AD / Entra)
 *
 * Token characteristics:
 * - Access token lifetime: ~1 hour (configurable via token lifetime policies)
 * - Refresh token: 90 days (revoked on password change)
 * - Token rotation: Yes (Microsoft rotates refresh tokens by default)
 *
 * Tenant options:
 * - 'common': Any Microsoft account (personal + work)
 * - 'organizations': Work/school accounts only
 * - 'consumers': Personal Microsoft accounts only
 * - '{tenant-id}': Specific organization only
 */

import type { TokenProvider, ProviderConfig, RefreshResult, RefreshFailure } from '../types';

const DEFAULT_TENANT = 'common';

interface MicrosoftTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string; // Microsoft usually returns a new refresh token
}

interface MicrosoftErrorResponse {
  error: string;
  error_description?: string;
  error_codes?: number[];
}

/**
 * Microsoft AADSTS error codes that indicate permanent token revocation
 * - 70000: Refresh token expired
 * - 50173: Refresh token expired (password change)
 * - 700082: Refresh token expired (inactivity)
 */
const REVOCATION_ERROR_CODES = [70000, 50173, 700082];

/**
 * Microsoft OAuth token provider
 */
export class MicrosoftProvider implements TokenProvider {
  readonly id = 'microsoft';
  readonly supportsRefresh = true;

  private getTokenUrl(tenantId: string): string {
    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  }

  async refresh(
    refreshToken: string,
    config: ProviderConfig
  ): Promise<RefreshResult | RefreshFailure> {
    const tenantId = config.tenantId ?? DEFAULT_TENANT;
    const tokenUrl = this.getTokenUrl(tenantId);

    const response = await fetch(tokenUrl, {
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
      const error = (await response.json()) as MicrosoftErrorResponse;
      console.error(
        `[MicrosoftProvider] Token refresh failed: ${error.error} - ${error.error_description}`
      );

      // Check for permanent revocation errors
      const isRevoked =
        error.error === 'invalid_grant' ||
        error.error_codes?.some((code) => REVOCATION_ERROR_CODES.includes(code));

      if (isRevoked) {
        return {
          revoked: true,
          errorCode: error.error,
          errorMessage: error.error_description,
        };
      }

      // Other errors (rate limit, server error) - throw for retry
      throw new Error(`Token refresh failed: ${error.error} - ${error.error_description || ''}`);
    }

    const data = (await response.json()) as MicrosoftTokenResponse;

    return {
      accessToken: data.access_token,
      // Microsoft typically returns a new refresh token - always use it!
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}

/**
 * Default Microsoft provider instance
 */
export const microsoftProvider = new MicrosoftProvider();
