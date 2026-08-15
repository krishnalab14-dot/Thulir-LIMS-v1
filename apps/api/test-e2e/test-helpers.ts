import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Stage 7 real-auth helpers. Every integration suite now authenticates over
 * the real /api/auth endpoints instead of the retired x-organization-id
 * header + SYSTEM_USER_ID stub — the auth plumbing changed, the business
 * assertions did not.
 */

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/** Logs in over the real HTTP stack and returns the tokens + user id. */
export async function loginAs(app: INestApplication, username: string, password: string): Promise<AuthSession> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username, password });
  if (res.status !== 201) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return {
    accessToken: res.body.accessToken as string,
    refreshToken: res.body.refreshToken as string,
    userId: res.body.user.id as string,
  };
}

/** The seeded org_demo admin (see prisma/seed.ts). */
export const loginAdmin = (app: INestApplication) => loginAs(app, 'admin', 'Thulir@123');

/** Authorization header object for supertest .set(). */
export const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

/**
 * Registers a brand-new organization (public endpoint) and returns its
 * first admin's session — the real-auth replacement for the old
 * `x-organization-id: org_other` header used in cross-tenant tests. Each
 * call creates a fresh org with a unique username, so cross-tenant queues
 * are genuinely empty and cross-tenant writes genuinely affect zero rows.
 */
export async function registerOrgAdmin(app: INestApplication, suffix: string): Promise<AuthSession> {
  const username = `other_admin_${suffix}`;
  const password = 'Other@1234';
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ organizationName: `Other Org ${suffix}`, username, password });
  if (res.status !== 201) {
    throw new Error(`org registration failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return loginAs(app, username, password);
}
