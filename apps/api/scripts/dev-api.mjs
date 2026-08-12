#!/usr/bin/env node
/**
 * Thulir LIMS API — dev entrypoint (`npm run dev` / `npm run dev:api`).
 *
 * Resolves the database BEFORE starting the NestJS watcher, so the dev
 * command works from a clean checkout with no Docker and no keys:
 *
 *   1. `DATABASE_URL` from the process environment (Freebuff Keys / host env)
 *   2. `DATABASE_URL` from apps/api/.env
 *   3. Otherwise: boots an embedded PostgreSQL (the `embedded-postgres`
 *      package, already a devDependency), applies the committed migrations
 *      (`prisma migrate deploy`) and seeds the demo org, then points the API
 *      at it.
 *
 * A candidate URL is only used if it is BOTH reachable AND already migrated
 * (has the `Organization` table) — otherwise we fall through to the next
 * option. This way a stale or schema-less URL (e.g. a freshly created Supabase
 * project with no migrations applied yet) can never strand the preview.
 *
 * Root sandboxes: PostgreSQL refuses to run as EUID 0, so when this process
 * runs as root the embedded instance is booted by a small keepalive child
 * (scripts/embedded-pg-keepalive.mjs) launched under a non-root user
 * (thulirpg → daytona → postgres → nobody, override with PREVIEW_PG_USER).
 * NestJS itself keeps running as root, exactly as the platform runs it.
 *
 * The embedded Postgres lives for the lifetime of the dev session: the
 * keepalive child is SIGTERMed on exit. The data dir persists across restarts
 * and seeding is skipped when the org already exists, so preview data
 * survives restarts.
 *
 * The API listens on `API_PORT` (default 3000), deliberately NOT the shared
 * `PORT` variable — Freebuff injects `PORT` for the web dev server and Vite
 * binds it, so a shared variable made the two dev servers fight over one port
 * (Nest crashed with EADDRINUSE and the /api proxy 500'd).
 */
import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const API_DIR = path.resolve(import.meta.dirname, '..');
const KEEPALIVE = path.join(import.meta.dirname, 'embedded-pg-keepalive.mjs');
const log = (...args) => console.log('[dev-api]', ...args);
const short = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 300);
const dataDir = () => process.env.EMBEDDED_PG_DIR ?? path.join(os.tmpdir(), 'thulir-embedded-pg-preview');
const pgPort = () => Number(process.env.PREVIEW_PG_PORT ?? 5433);
const dbUrl = (port) =>
  `postgresql://thulir:thulir@127.0.0.1:${port}/thulir_lims?schema=public&connection_limit=10`;

/** Reads DATABASE_URL out of apps/api/.env without printing its value. */
function dotEnvDatabaseUrl() {
  const file = path.join(API_DIR, '.env');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*)$/m);
  if (!m) return null;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v || null;
}

async function query(url, sql) {
  // Named export: `pg` is CommonJS, so `default` would be the whole
  // module.exports object, not the Client class.
  const { Client } = await import('pg');
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    return await c.query(sql);
  } finally {
    await c.end().catch(() => {});
  }
}

async function reachable(url) {
  try {
    await query(url, 'SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function hasSchema(url) {
  try {
    const r = await query(url, `SELECT to_regclass('public."Organization"') IS NOT NULL AS ok`);
    return r.rows[0]?.ok === true;
  } catch {
    return false;
  }
}

async function resolveDatabaseUrl() {
  // 1. process env
  if (process.env.DATABASE_URL) {
    if (!(await reachable(process.env.DATABASE_URL))) {
      log('DATABASE_URL from the environment is not reachable — trying the next source.');
    } else if (!(await hasSchema(process.env.DATABASE_URL))) {
      log('DATABASE_URL from the environment is reachable but has no schema — booting embedded PostgreSQL instead.');
    } else {
      return process.env.DATABASE_URL;
    }
  }
  // 2. apps/api/.env
  const fromFile = dotEnvDatabaseUrl();
  if (fromFile) {
    if (!(await reachable(fromFile))) {
      log('DATABASE_URL from apps/api/.env is not reachable — booting embedded PostgreSQL instead.');
    } else if (!(await hasSchema(fromFile))) {
      log('DATABASE_URL from apps/api/.env is reachable but has no schema — booting embedded PostgreSQL instead.');
    } else {
      return fromFile;
    }
  }
  // 3. embedded PostgreSQL
  return null;
}

function pickNonRootUser() {
  const explicit = process.env.PREVIEW_PG_USER;
  if (explicit) return explicit;
  for (const name of ['thulirpg', 'daytona', 'postgres', 'nobody']) {
    try {
      execSync(`getent passwd ${name} >/dev/null 2>&1`, { stdio: 'ignore' });
      return name;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Boots embedded PostgreSQL. In a root sandbox the server itself runs in a
 *  non-root keepalive child; otherwise it is booted in-process. */
async function bootEmbedded() {
  const port = pgPort();
  const dir = dataDir();
  const url = dbUrl(port);

  // Reuse an instance already serving this database (leftover from a
  // previous session whose watcher died but Postgres survived).
  if (await reachable(url)) {
    log(`Reusing embedded PostgreSQL at 127.0.0.1:${port}`);
    return { url, stop: async () => {} };
  }

  const isRoot = process.getuid?.() === 0;
  if (isRoot) {
    const user = pickNonRootUser();
    if (!user) {
      throw new Error(
        'Running as root and no non-root user exists to run embedded PostgreSQL. Set DATABASE_URL or PREVIEW_PG_USER.',
      );
    }
    fs.mkdirSync(dir, { recursive: true });
    try {
      execSync(`chown -R ${user}:${user} "${dir}"`, { stdio: 'ignore' });
    } catch (e) {
      log(`chown of embedded-PG data dir failed: ${short(e)}`);
    }
    log(`Booting embedded PostgreSQL as '${user}' (keepalive child)…`);
    const child = spawn(
      'runuser',
      ['-p', '-u', user, '--', process.execPath, KEEPALIVE, dir, String(port)],
      { stdio: 'inherit' },
    );
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    };

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (await reachable(url)) {
        log(`Embedded PostgreSQL listening on 127.0.0.1:${port} (DB: thulir_lims)`);
        return { url, stop };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    stop();
    throw new Error(`Embedded PostgreSQL (keepalive child) not reachable on port ${port}`);
  }

  // Non-root: boot in-process.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    log(`Data dir ${dir} is not writable — resetting it.`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'thulir',
    password: 'thulir',
    port,
    persistent: true,
  });
  const notes = [];
  try {
    await pg.initialise();
  } catch (e) {
    notes.push(`initdb: ${short(e)}`);
  }
  try {
    await pg.start();
  } catch (e) {
    notes.push(`start: ${short(e)}`);
  }
  try {
    await pg.createDatabase('thulir_lims');
  } catch {
    /* already exists */
  }
  for (let i = 0; i < 12; i++) {
    if (await reachable(url)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await reachable(url))) {
    throw new Error(
      `Embedded PostgreSQL not reachable on port ${port}${notes.length ? ' — ' + notes.join('; ') : ''}`,
    );
  }
  log(`Embedded PostgreSQL listening on 127.0.0.1:${port} (DB: thulir_lims)`);
  return {
    url,
    stop: async () => {
      try {
        await pg.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

async function main() {
  let embedded = null;
  let url = await resolveDatabaseUrl();
  if (!url) {
    embedded = await bootEmbedded();
    url = embedded.url;
  }

  // Apply migrations and seed a fresh database (never re-seed an existing one —
  // the seed wipes the demo org, and the preview should keep its data).
  const run = (cmd) =>
    execSync(cmd, {
      cwd: API_DIR,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    });

  if (!(await hasSchema(url))) {
    log('Applying migrations (prisma migrate deploy)…');
    run('npx --no-install prisma migrate deploy');
  }
  if (!(await hasSchema(url))) {
    throw new Error('Migrations did not create the schema — the database is unusable.');
  }

  const orgCount = (await query(url, 'SELECT COUNT(*)::int AS n FROM "Organization"')).rows[0].n;
  if (orgCount === 0) {
    log('Empty database — seeding the demo organization + catalog…');
    run('npx --no-install tsx prisma/seed.ts');
  } else {
    log(`Database already has data (${orgCount} organization(s)) — skipping seed.`);
  }

  const apiPort = process.env.API_PORT ?? '3000';
  log(`Starting NestJS watcher on port ${apiPort} (API_PORT), DB: ${url.split('@').pop()}`);

  const child = spawn('nest start --watch', {
    cwd: API_DIR,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: url, API_PORT: apiPort },
  });

  const shutdown = () => {
    try {
      embedded?.stop();
    } catch {
      /* already stopped */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code, signal) => {
    if (signal) shutdown();
    try {
      embedded?.stop();
    } catch {
      /* already stopped */
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[dev-api] FATAL:', err);
  process.exit(1);
});
