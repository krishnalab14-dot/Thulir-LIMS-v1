/**
 * Embedded PostgreSQL helper — real PostgreSQL without Docker.
 *
 * Uses the `embedded-postgres` npm package, which ships real PostgreSQL
 * binaries (currently 18.4 on linux-x64) inside node_modules. The data
 * directory lives in os.tmpdir() and is wiped on every start, so this is a
 * throwaway instance intended for verification runs (`verify-real-db`), not
 * for persistent local data.
 *
 * NOTE: PostgreSQL refuses to run as root. If the sandbox user is root,
 * run the orchestrator through a non-root account, e.g.:
 *   runuser -u thulirpg -- bash -lc 'cd <repo> && npm run verify:real-db'
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface EmbeddedPgHandle {
  port: number;
  client: import('pg').Client;
  stop: () => Promise<void>;
}

export async function startEmbeddedPostgres(): Promise<EmbeddedPgHandle> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const port = Number(process.env.PG_PORT ?? 5432);
  const dataDir = process.env.EMBEDDED_PG_DIR ?? path.join(os.tmpdir(), 'thulir-embedded-pg');
  fs.rmSync(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'thulir',
    password: 'thulir',
    port,
    persistent: true,
  });

  await pg.initialise(); // initdb
  await pg.start(); // start the server
  await pg.createDatabase('thulir_lims');

  const client = pg.getPgClient('thulir_lims');
  await client.connect();

  return {
    port,
    client,
    stop: async () => {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
      try {
        await pg.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
