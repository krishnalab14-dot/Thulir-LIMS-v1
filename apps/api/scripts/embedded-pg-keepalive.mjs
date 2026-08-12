#!/usr/bin/env node
/**
 * Thulir LIMS — embedded PostgreSQL keepalive child.
 *
 * Runs under a NON-ROOT user (PostgreSQL refuses EUID 0) and keeps the
 * instance alive for the duration of the dev session. Usage:
 *
 *   runuser -u <non-root> -- node embedded-pg-keepalive.mjs <dataDir> <port>
 *
 * Prints "[embedded-pg] READY" once the server accepts connections, then
 * idles until SIGTERM/SIGINT (stopping PostgreSQL first). The parent
 * (scripts/dev-api.mjs) owns its lifecycle: spawn it, wait for READY, and
 * SIGTERM it on shutdown.
 *
 * The data dir persists across restarts — an already-initialised or already
 * running instance is reused, so preview data survives.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const [, , dataDirArg, portArg] = process.argv;
const dataDir = dataDirArg;
const port = Number(portArg);
const url = `postgresql://thulir:thulir@127.0.0.1:${port}/thulir_lims?schema=public&connection_limit=10`;

async function reachable() {
  try {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let pg = null;

  if (await reachable()) {
    console.log(`[embedded-pg] instance already serving 127.0.0.1:${port} — reusing it.`);
  } else {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');

    fs.mkdirSync(dataDir, { recursive: true });
    try {
      fs.accessSync(dataDir, fs.constants.W_OK);
    } catch {
      console.log(`[embedded-pg] data dir ${dataDir} not writable — resetting it.`);
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.mkdirSync(dataDir, { recursive: true });
    }

    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'thulir',
      password: 'thulir',
      port,
      persistent: true,
    });
    // Skip initdb on a reused cluster (PG_VERSION exists) — otherwise initdb
    // errors with "directory exists but is not empty" on every restart.
    if (fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      console.log(`[embedded-pg] reusing initialised cluster at ${dataDir}.`);
    } else {
      await pg.initialise();
    }
    try {
      await pg.start(); // start the server (throws if already running)
    } catch (e) {
      console.log(`[embedded-pg] start note: ${String(e?.message ?? e).split('\n')[0]}`);
    }
    try {
      await pg.createDatabase('thulir_lims'); // throws if it already exists
    } catch {
      // already exists — fine
    }

    for (let i = 0; i < 12; i++) {
      if (await reachable()) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await reachable())) {
      console.error(`[embedded-pg] FATAL: not reachable on port ${port}`);
      process.exit(1);
    }
  }

  console.log(`[embedded-pg] READY on 127.0.0.1:${port} (DB: thulir_lims)`);

  const shutdown = () => {
    try {
      pg?.stop();
    } catch {
      /* already stopped */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(() => {}, 1 << 30); // keep the process (and the Postgres child) alive
}

main().catch((err) => {
  console.error('[embedded-pg] FATAL:', err);
  process.exit(1);
});
