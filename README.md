# @jezweb/oauth-token-manager

OAuth token management for Cloudflare Workers. Store, refresh, and retrieve tokens for downstream API access.

## The Problem

When your application needs to call APIs on behalf of users (Google Calendar, GitHub, Xero, etc.), you need to:

1. **Store** OAuth tokens securely (encrypted at rest)
2. **Refresh** expired tokens automatically
3. **Retrieve** valid tokens for API calls
4. **Handle** errors gracefully (expired, revoked, insufficient scopes)

Most auth libraries focus on **identity** ("who is this user?") not **API access** ("act on their behalf"). This package fills that gap.

## Installation

```bash
npm install @jezweb/oauth-token-manager
```

## Quick Start

```typescript
import { TokenManager, KVStorage } from '@jezweb/oauth-token-manager';

// Initialize
const tokens = new TokenManager({
  storage: new KVStorage({
    namespace: env.TOKEN_KV,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
  }),
  encryptionKey: env.TOKEN_ENCRYPTION_KEY,
  providers: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
});

// Store token after OAuth callback
await tokens.store({
  userId: 'user-123',
  provider: 'google',
  accessToken: 'ya29.xxx',
  refreshToken: '1//xxx',
  expiresAt: Date.now() + 3600000,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

// Get valid token (auto-refreshes if expired)
const { accessToken } = await tokens.get({
  userId: 'user-123',
  provider: 'google',
});

// Use token for API call
const response = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

## Features

- **Encrypted storage** - Tokens encrypted at rest using AES-256-GCM
- **Automatic refresh** - Tokens refreshed before expiry (5 min buffer by default)
- **Scope validation** - Verify required scopes before returning tokens
- **Built-in providers** - Google, Microsoft, GitHub out of the box
- **Cloudflare-native** - Built specifically for Workers + KV
- **Clear errors** - Typed errors guide recovery actions

## API

### `TokenManager`

Main class for token management.

```typescript
const tokens = new TokenManager({
  storage: TokenStorage,        // KVStorage or custom
  encryptionKey: string,        // For encrypting tokens at rest
  providers: {                  // Provider configs for refresh
    google?: ProviderConfig,
    microsoft?: ProviderConfig,
    github?: ProviderConfig,
  },
  defaultRefreshBuffer?: number, // ms before expiry to refresh (default: 5 min)
});
```

#### Methods

| Method | Description |
|--------|-------------|
| `store(options)` | Store a new token or update existing |
| `get(options)` | Get valid token (auto-refreshes) |
| `list(options)` | List connected providers for a user |
| `revoke(options)` | Delete a token |
| `has(userId, provider)` | Check if token exists |

### Error Types

| Error | Meaning | Recovery |
|-------|---------|----------|
| `TokenNotFoundError` | No token for user/provider | Redirect to OAuth |
| `TokenExpiredError` | Token expired, refresh failed | Redirect to OAuth |
| `InsufficientScopesError` | Missing required scopes | Redirect to OAuth with incremental consent |
| `ProviderNotConfiguredError` | Provider not in config | Add provider config |

## Supported Providers

| Provider | Refresh Support | Token Lifetime | Notes |
|----------|-----------------|----------------|-------|
| Google | ✅ Yes | ~1 hour | Requires `access_type=offline` |
| Microsoft | ✅ Yes | ~1 hour | Token rotation by default |
| GitHub | ❌ No | Never expires | Tokens valid until revoked |

## Storage Adapters

### KV Storage (Recommended)

```typescript
import { KVStorage } from '@jezweb/oauth-token-manager/storage/kv';

const storage = new KVStorage({
  namespace: env.TOKEN_KV,
  encryptionKey: env.TOKEN_ENCRYPTION_KEY,
  keyPrefix: 'tokens', // optional, default: 'tokens'
});
```

### D1 Storage (Coming Soon)

D1 adapter for stronger consistency and complex queries.

## Wrangler Setup

```toml
# wrangler.toml
kv_namespaces = [
  { binding = "TOKEN_KV", id = "your-kv-id" }
]

[vars]
# Store encryption key as secret, not here!
```

```bash
# Set encryption key (generate with: openssl rand -base64 32)
echo "your-32-byte-key" | wrangler secret put TOKEN_ENCRYPTION_KEY
```

## Use Cases

- **MCP Servers** - Call Google Calendar, GitHub, etc. on behalf of users
- **CRM integrations** - Sync with external calendars, email
- **Social media tools** - Post to Twitter, LinkedIn
- **Accounting apps** - Connect to Xero, QuickBooks

## Architecture

This package handles **outbound** OAuth (your app calling external APIs).

For **inbound** OAuth (clients authenticating to your app), use:
- [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
- [better-auth](https://better-auth.com)

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ MCP Client  │────▶│   Your App      │────▶│  External API   │
│ (Claude.ai) │     │                 │     │ (Google, etc)   │
└─────────────┘     └─────────────────┘     └─────────────────┘
       │                    │                       │
       ▼                    ▼                       ▼
  Inbound auth         Token Manager           External OAuth
  (who is client?)     (this package)          (act on behalf)
```

## Security

See [SECURITY.md](./SECURITY.md) for security considerations.

## License

MIT © [Jezweb](https://jezweb.com.au)
