/**
 * Cloudflare D1 Storage Adapter (Placeholder)
 *
 * D1 provides stronger consistency guarantees than KV and allows
 * for more complex queries (e.g., find all tokens expiring soon).
 *
 * TODO: Implement full D1 adapter with migrations
 */

import type { TokenStorage, StoredToken, ConnectedProvider } from '../types';

/**
 * D1 Storage adapter for Cloudflare D1
 *
 * NOT YET IMPLEMENTED - Use KVStorage for now
 */
export class D1Storage implements TokenStorage {
  constructor(_db: D1Database, _encryptionKey: string) {
    throw new Error(
      'D1Storage is not yet implemented. Use KVStorage instead, or contribute an implementation!'
    );
  }

  get(_userId: string, _provider: string): Promise<StoredToken | null> {
    throw new Error('Not implemented');
  }

  set(_token: StoredToken): Promise<void> {
    throw new Error('Not implemented');
  }

  delete(_userId: string, _provider: string): Promise<void> {
    throw new Error('Not implemented');
  }

  list(_userId: string): Promise<ConnectedProvider[]> {
    throw new Error('Not implemented');
  }
}
