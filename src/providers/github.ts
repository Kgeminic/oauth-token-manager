/**
 * GitHub OAuth Provider
 *
 * Token characteristics:
 * - Access token lifetime: Does not expire!
 * - Refresh token: Not applicable (tokens don't expire)
 * - Token rotation: Not applicable
 *
 * GitHub tokens are valid until explicitly revoked by the user or
 * the OAuth app is deleted. This makes GitHub simpler to handle
 * but also means stale tokens may accumulate if users disconnect
 * without revoking access.
 *
 * To revoke a token programmatically, use the GitHub API:
 * DELETE /applications/{client_id}/token
 */

import type { TokenProvider, ProviderConfig, RefreshResult, RefreshFailure } from '../types';

/**
 * GitHub OAuth token provider
 *
 * Note: GitHub tokens don't expire, so refresh() should never be called.
 * If it is called, the token must have been revoked.
 */
export class GitHubProvider implements TokenProvider {
  readonly id = 'github';
  readonly supportsRefresh = false;

  async refresh(
    _refreshToken: string,
    _config: ProviderConfig
  ): Promise<RefreshResult | RefreshFailure> {
    // GitHub tokens don't expire - if we're here, the token was revoked
    console.warn(
      '[GitHubProvider] refresh() called but GitHub tokens do not expire. ' +
        'The token must have been revoked.'
    );
    return {
      revoked: true,
      errorCode: 'github_tokens_dont_expire',
      errorMessage: 'GitHub tokens do not expire. If invalid, the token was revoked.',
    };
  }
}

/**
 * Default GitHub provider instance
 */
export const githubProvider = new GitHubProvider();

/**
 * Revoke a GitHub OAuth token
 *
 * Call this when a user disconnects their GitHub account to properly
 * clean up the token on GitHub's side.
 *
 * @param accessToken - The token to revoke
 * @param clientId - Your GitHub OAuth app client ID
 * @param clientSecret - Your GitHub OAuth app client secret
 * @returns true if revoked successfully, false otherwise
 */
export async function revokeGitHubToken(
  accessToken: string,
  clientId: string,
  clientSecret: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/applications/${clientId}/token`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      }
    );

    // 204 No Content = success
    // 404 = token already invalid/revoked
    return response.status === 204 || response.status === 404;
  } catch (error) {
    console.error('[GitHubProvider] Token revocation failed:', error);
    return false;
  }
}
