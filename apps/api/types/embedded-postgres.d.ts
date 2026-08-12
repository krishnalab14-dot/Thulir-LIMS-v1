/**
 * Minimal ambient declaration for `embedded-postgres` (used only by
 * scripts/embedded-pg.ts for real-DB verification). The package is ESM-only
 * and ships no types; these are the members this repo actually uses.
 */
declare module 'embedded-postgres' {
  import type { Client } from 'pg';

  interface EmbeddedPostgresOptions {
    databaseDir: string;
    user?: string;
    password?: string;
    port?: number;
    persistent?: boolean;
  }

  export default class EmbeddedPostgres {
    constructor(options: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
    getPgClient(database?: string, host?: string): Client;
  }
}
