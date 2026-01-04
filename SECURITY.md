# Security Considerations

This document describes the security model of `@jezweb/oauth-token-manager`.

## Token Encryption

### Algorithm

- **Encryption**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2 with SHA-256, 100,000 iterations
- **IV**: Random 12 bytes per encryption
- **Salt**: Random 16 bytes per encryption

### What's Encrypted

| Field | Encrypted | Reason |
|-------|-----------|--------|
| `accessToken` | ✅ Yes | Sensitive credential |
| `refreshToken` | ✅ Yes | Sensitive credential |
| `userId` | ❌ No | Needed for lookup |
| `provider` | ❌ No | Needed for lookup |
| `scopes` | ❌ No | Not sensitive |
| `expiresAt` | ❌ No | Useful for auditing |
| `createdAt` | ❌ No | Useful for auditing |
| `updatedAt` | ❌ No | Useful for auditing |

### Security Properties

1. **Confidentiality**: Tokens cannot be read without the encryption key
2. **Integrity**: GCM authentication tag detects tampering
3. **Forward secrecy**: Each encryption uses a unique salt + IV
4. **No key exposure**: Encryption key never stored, only used

## Encryption Key Management

### Requirements

- **Length**: 32+ bytes recommended (256 bits)
- **Randomness**: Use cryptographically secure random generation
- **Storage**: Store as Wrangler secret, never in code or env vars

### Generating a Key

```bash
# Generate a secure key
openssl rand -base64 32

# Store as Wrangler secret
echo "your-key" | wrangler secret put TOKEN_ENCRYPTION_KEY
```

### Key Rotation

Key rotation is NOT currently supported. If you need to rotate:

1. Deploy new version with new key
2. Users must re-authenticate to get new tokens
3. Old tokens become unreadable

Future versions may support key rotation with re-encryption.

## Storage Security

### KV Storage

- Tokens stored with user-specific keys: `tokens:{userId}:{provider}`
- Index stored separately: `token-index:{userId}`
- No cross-user data access possible with correct key structure

### Access Control

- Your Worker has full access to the KV namespace
- Implement authorization in your Worker to control which users can access which tokens
- Never expose TokenManager methods directly to untrusted input

## Provider Credentials

### Storage

- Provider `clientId` and `clientSecret` should be stored as Wrangler secrets
- Never hardcode credentials in source code
- Use environment variables via Wrangler bindings

### Exposure Risk

If provider credentials are compromised:

1. Attacker could refresh tokens (if they also have refresh tokens)
2. Attacker could NOT decrypt stored tokens without encryption key
3. Revoke compromised credentials immediately in provider console

## Attack Vectors

### Storage Breach

If KV storage is compromised:

| Data Exposed | Risk | Mitigation |
|--------------|------|------------|
| Encrypted tokens | Low | Cannot decrypt without key |
| User IDs | Medium | Consider hashing user IDs |
| Scopes | Low | Not sensitive |
| Timestamps | Low | Audit trail only |

### Encryption Key Breach

If encryption key is compromised:

| Risk | Impact |
|------|--------|
| Decrypt all tokens | High - full API access |
| Impersonate users | High - act as any user |

**Mitigation**: Rotate key immediately, invalidate all tokens.

### Provider Token Theft

If decrypted tokens are stolen:

| Token Type | Risk | Mitigation |
|------------|------|------------|
| Access token | Time-limited (~1h) | Short expiry |
| Refresh token | Long-lived | Revoke at provider |

## Best Practices

### Do

- ✅ Use strong encryption keys (32+ bytes, random)
- ✅ Store encryption key as Wrangler secret
- ✅ Store provider credentials as secrets
- ✅ Validate user authorization before token access
- ✅ Log token access for audit (without logging tokens)
- ✅ Monitor for unusual access patterns

### Don't

- ❌ Log tokens or encryption keys
- ❌ Include tokens in error messages
- ❌ Store encryption key in source code
- ❌ Use predictable encryption keys
- ❌ Skip user authorization checks

## Reporting Vulnerabilities

If you discover a security vulnerability:

1. **Do not** open a public GitHub issue
2. Email security concerns to jeremy@jezweb.net
3. Include steps to reproduce
4. Allow 90 days for fix before disclosure

## Compliance

This package:

- Uses industry-standard encryption (AES-256-GCM)
- Does not transmit tokens to third parties
- Does not store encryption keys
- Provides audit trail via timestamps

For specific compliance requirements (GDPR, SOC2, etc.), consult your compliance team about overall system architecture.
