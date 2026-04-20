import { unlinkSync, existsSync } from 'fs';

export default async function globalTeardown() {
  for (const f of ['/tmp/chorequest_e2e.db', '/tmp/chorequest_e2e_tokens.json']) {
    if (existsSync(f)) unlinkSync(f);
  }
  console.log('✓ E2E cleanup complete');
}
