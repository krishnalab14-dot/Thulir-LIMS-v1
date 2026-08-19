import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import type { PortalJwtPayload } from './portal.types';

const REFRESH_BYTES = 48;

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(REFRESH_BYTES).toString('base64url');
}

// ---------------------------------------------------------------------------
// In-memory rate limiter for patient login (§2: 5 attempts / 15 min / mobile)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class PortalAuthService {
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tenant: TenantContextService,
  ) {}

  private checkRateLimit(mobile: string): void {
    const now = Date.now();
    const entry = this.rateLimits.get(mobile);

    if (!entry || now >= entry.resetAt) {
      this.rateLimits.set(mobile, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }

    entry.attempts++;
    if (entry.attempts > RATE_LIMIT_MAX) {
      throw new UnauthorizedException('Too many login attempts. Please try again later.');
    }
  }

  private resetRateLimit(mobile: string): void {
    this.rateLimits.delete(mobile);
  }

  /**
   * Sign a portal JWT. Patient tokens carry patientId; referrer tokens
   * carry partyId. Both carry organizationId and the discriminating `type`.
   */
  private signPortalToken(payload: PortalJwtPayload): string {
    return this.jwt.sign(payload, { expiresIn: '7d' });
  }

  // ---------------------------------------------------------------------------
  // Patient login: mobile + DOB (§1)
  // ---------------------------------------------------------------------------

  /**
   * POST /api/portal/patient/login — mobile + DOB. Matches against
   * Patient.mobile + Patient.dob exactly. Rate-limited (5 per 15 min per
   * mobile). On success issues a patient JWT. On failure returns a generic
   * "invalid credentials" regardless of which factor was wrong.
   */
  async patientLogin(mobile: string, dob: string) {
    const normalizedMobile = mobile.trim();

    // Rate limit check BEFORE the DB query (§2).
    this.checkRateLimit(normalizedMobile);

    const dobDate = new Date(dob);
    if (isNaN(dobDate.getTime())) {
      // Treat invalid DOB the same as "no match" — generic failure.
      throw new UnauthorizedException('Invalid credentials');
    }

    // Tenant-scoped: find a patient with matching mobile in this org.
    const patient = await this.prisma.prisma.patient.findFirst({
      where: {
        mobile: normalizedMobile,
        dob: dobDate,
      },
      select: { id: true, organizationId: true },
    });

    if (!patient) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Match found — clear rate limit for this mobile.
    this.resetRateLimit(normalizedMobile);

    const accessToken = this.signPortalToken({
      sub: patient.id,
      organizationId: patient.organizationId,
      type: 'patient',
      patientId: patient.id,
    });

    const refreshToken = newRefreshToken();
    // Store the refresh token hash on the Patient record (reuse the same
    // pattern as staff auth — hashed, rotated on refresh, invalidated on
    // logout). Add portalRefreshTokenHash column to Patient via a future
    // migration if needed; for now, store in-memory keyed by patientId
    // (same as the rate limiter — acceptable for this stage).
    //
    // NOTE: The Patient model doesn't have refreshTokenHash yet. We'll
    // store portal refresh tokens in a simple in-memory map for this stage,
    // matching the rate-limiter approach. A production system would add the
    // column to Patient.
    this.patientRefreshTokens.set(patient.id, hashRefreshToken(refreshToken));

    return {
      accessToken,
      refreshToken,
      patient: { id: patient.id, organizationId: patient.organizationId },
    };
  }

  // In-memory refresh token store for patients (see note above).
  private readonly patientRefreshTokens = new Map<string, string>();

  async patientRefresh(refreshToken: string) {
    const hash = hashRefreshToken(refreshToken);

    // Find the patient whose stored hash matches.
    for (const [patientId, storedHash] of this.patientRefreshTokens) {
      if (storedHash === hash) {
        const patient = await this.prisma.prisma.patient.findUnique({
          where: { id: patientId },
          select: { id: true, organizationId: true },
        });
        if (!patient) {
          this.patientRefreshTokens.delete(patientId);
          throw new UnauthorizedException('Invalid refresh token');
        }

        // Rotate: issue new tokens, invalidate old.
        const newRefresh = newRefreshToken();
        this.patientRefreshTokens.set(patientId, hashRefreshToken(newRefresh));

        return {
          accessToken: this.signPortalToken({
            sub: patient.id,
            organizationId: patient.organizationId,
            type: 'patient',
            patientId: patient.id,
          }),
          refreshToken: newRefresh,
          patient: { id: patient.id, organizationId: patient.organizationId },
        };
      }
    }

    throw new UnauthorizedException('Invalid refresh token');
  }

  async patientLogout(refreshToken: string) {
    const hash = hashRefreshToken(refreshToken);
    for (const [patientId, storedHash] of this.patientRefreshTokens) {
      if (storedHash === hash) {
        this.patientRefreshTokens.delete(patientId);
        return { ok: true };
      }
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Referrer login: username + password (§1)
  // ---------------------------------------------------------------------------

  /**
   * POST /api/portal/referrer/login — username + password. Credentials are
   * admin-issued (§1: admin sets up portal access, not self-registration).
   * Generic failure message on mismatch (same non-leaking principle).
   */
  async referrerLogin(username: string, password: string) {
    const trimmedUsername = username.trim();

    // Tenant-scoped: find a Party with matching portalUsername.
    const party = await this.prisma.prisma.party.findFirst({
      where: {
        portalUsername: trimmedUsername,
      },
      select: { id: true, organizationId: true, portalPasswordHash: true },
    });

    if (!party || !party.portalPasswordHash) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const ok = await bcrypt.compare(password, party.portalPasswordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const accessToken = this.signPortalToken({
      sub: party.id,
      organizationId: party.organizationId,
      type: 'referrer',
      partyId: party.id,
    });

    const refreshToken = newRefreshToken();
    this.referrerRefreshTokens.set(party.id, hashRefreshToken(refreshToken));

    return {
      accessToken,
      refreshToken,
      referrer: { id: party.id, organizationId: party.organizationId },
    };
  }

  // In-memory refresh token store for referrers.
  private readonly referrerRefreshTokens = new Map<string, string>();

  async referrerRefresh(refreshToken: string) {
    const hash = hashRefreshToken(refreshToken);

    for (const [partyId, storedHash] of this.referrerRefreshTokens) {
      if (storedHash === hash) {
        const party = await this.prisma.prisma.party.findUnique({
          where: { id: partyId },
          select: { id: true, organizationId: true },
        });
        if (!party) {
          this.referrerRefreshTokens.delete(partyId);
          throw new UnauthorizedException('Invalid refresh token');
        }

        const newRefresh = newRefreshToken();
        this.referrerRefreshTokens.set(partyId, hashRefreshToken(newRefresh));

        return {
          accessToken: this.signPortalToken({
            sub: party.id,
            organizationId: party.organizationId,
            type: 'referrer',
            partyId: party.id,
          }),
          refreshToken: newRefresh,
          referrer: { id: party.id, organizationId: party.organizationId },
        };
      }
    }

    throw new UnauthorizedException('Invalid refresh token');
  }

  async referrerLogout(refreshToken: string) {
    const hash = hashRefreshToken(refreshToken);
    for (const [partyId, storedHash] of this.referrerRefreshTokens) {
      if (storedHash === hash) {
        this.referrerRefreshTokens.delete(partyId);
        return { ok: true };
      }
    }
    return { ok: true };
  }
}
