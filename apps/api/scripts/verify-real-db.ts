/**
 * Real-DB verification for Stage 1 — one bounded command that:
 *   1. starts an embedded PostgreSQL (no Docker required)
 *   2. applies the committed migrations (`prisma migrate deploy`)
 *   3. seeds the demo org + catalog
 *   4. runs the real-DB integration suite (test-e2e/) over the real HTTP stack
 *   5. prints a row-level summary of what landed in the DB
 * …then stops the server. Safe to re-run; the data dir is wiped on start.
 *
 * Usage:
 *   npm run verify:real-db          # (add runuser -u <non-root> if root)
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { startEmbeddedPostgres } from './embedded-pg';

const API_DIR = path.resolve(__dirname, '..');

function run(step: string, cmd: string, env: NodeJS.ProcessEnv = {}): void {
  console.log(`\n===== ${step} =====`);
  execSync(cmd, { cwd: API_DIR, stdio: 'inherit', env: { ...process.env, ...env } });
}

async function main(): Promise<void> {
  const pg = await startEmbeddedPostgres();
  const dbUrl = `postgresql://thulir:thulir@127.0.0.1:${pg.port}/thulir_lims?schema=public`;

  try {
    console.log(`Embedded PostgreSQL listening on 127.0.0.1:${pg.port} (DB: thulir_lims)`);
    run('1/5 prisma migrate deploy (initial migration)', 'npx prisma migrate deploy', { DATABASE_URL: dbUrl });
    run('2/5 seed', 'npm run db:seed', { DATABASE_URL: dbUrl });
    run('3/5 integration tests against real DB', 'npm run test:integration', { DATABASE_URL: dbUrl });
    run('4/5 unit test suite (mock-based, unchanged)', 'npm test', { DATABASE_URL: dbUrl });
    run('5/5 DB state summary', 'npx tsx scripts/print-db-state.ts', { DATABASE_URL: dbUrl });
  } finally {
    await pg.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
