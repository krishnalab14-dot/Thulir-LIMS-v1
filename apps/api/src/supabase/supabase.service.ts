import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase integration (auth + storage layer).
 *
 * The LIMS keeps its own PostgreSQL via Prisma (Supabase is Postgres-based, so
 * the schema/migrations remain Prisma-managed); Supabase supplies the auth and
 * storage backend the app will consume. Clients are created LAZILY — the app
 * must boot and run its test suites before the keys are populated in the
 * Freebuff Keys/API-keys tab, so construction never touches the network or
 * throws; only calling a client method when SUPABASE_URL/keys are missing
 * raises a clear configuration error.
 *
 * Server-side only: the service-role key never leaves this process (never use
 * it from the browser — the anon key is the public one).
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private anonClient: SupabaseClient | null = null;
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {}

  /** https://<project-ref>.supabase.co */
  get url(): string | undefined {
    return this.config.get<string>('SUPABASE_URL');
  }

  /** The short project reference (also embedded in the URL). */
  get projectRef(): string | undefined {
    return this.config.get<string>('SUPABASE_PROJECT_REF');
  }

  /** True when the public URL + anon key are present. */
  isConfigured(): boolean {
    return Boolean(this.url && this.config.get<string>('SUPABASE_ANON_KEY'));
  }

  /**
   * Public (anon) client — safe anywhere, used to verify session JWTs and for
   * storage access scoped by the caller's role.
   */
  getAnonClient(): SupabaseClient {
    const url = this.config.get<string>('SUPABASE_URL');
    const anonKey = this.config.get<string>('SUPABASE_ANON_KEY');
    if (!url || !anonKey) {
      throw new Error(
        'Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY in the Freebuff Keys/API-keys tab (and apps/api/.env locally).',
      );
    }
    if (!this.anonClient) {
      this.anonClient = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      this.logger.log('Supabase anon client created');
    }
    return this.anonClient;
  }

  /**
   * Service-role (admin) client — server-side only. For admin operations the
   * anon/RLS policies cannot cover (e.g. managed user provisioning, storage
   * admin), never exposed to the browser.
   */
  getAdminClient(): SupabaseClient {
    const url = this.config.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) {
      throw new Error(
        'Supabase admin client is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Freebuff Keys/API-keys tab (and apps/api/.env locally).',
      );
    }
    if (!this.adminClient) {
      this.adminClient = createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      this.logger.log('Supabase admin client created');
    }
    return this.adminClient;
  }

  /**
   * Validates a Supabase access-token JWT and returns the authenticated user.
   * This is the building block the auth stage will use: NestJS guards resolve
   * `Authorization: Bearer <token>` through here, then map `user.id` into the
   * tenant/user scoping that currently uses SYSTEM_USER_ID.
   */
  async verifyToken(token: string) {
    const { data, error } = await this.getAnonClient().auth.getUser(token);
    if (error) {
      throw error;
    }
    return data.user;
  }
}
