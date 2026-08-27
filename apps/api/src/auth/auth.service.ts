import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import type { AuthUser, JwtPayload } from './auth.types';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { nextStaffCode } from './staff-code.util';

const REFRESH_BYTES = 48;

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(REFRESH_BYTES).toString('base64url');
}

/**
 * Stage 7 real auth — replaces the x-organization-id header + SYSTEM_USER_ID
 * stub that every earlier stage documented as temporary.
 *
 * TENANT-FREE EXCEPTION (documented, allowlisted): register/login/refresh run
 * on PrismaService.raw — the same escape hatch public-verify uses. Login and
 * refresh cannot know the tenant before resolving the user (usernames are
 * globally unique; the org is read OFF the matched row), and registration
 * bootstraps a brand-new org that has no tenant context by definition. The
 * org id is set EXPLICITLY on every user write here, never injected by the
 * extension. Every OTHER service keeps using the fail-closed tenant-scoped
 * client — this module is the only place that may touch User without a
 * tenant context.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tenant: TenantContextService,
  ) {}

  private signAccessToken(user: { id: string; organizationId: string; role: Role; username: string }): string {
    const payload: JwtPayload = {
      sub: user.id,
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      username: user.username,
    };
    return this.jwt.sign(payload);
  }

  /**
   * POST /api/auth/register — first registration for a NEW organization:
   * creates the Organization and its first User (admin) in ONE transaction.
   * Username uniqueness is checked first (fast 409) AND enforced by the DB
   * unique index (two simultaneous registers for the same username → the
   * loser hits P2002 and gets the same 409 — the race is closed, not papered
   * over). Nothing here can add a user to an EXISTING org; that is the
   * admin-only POST /api/users path, kept strictly separate.
   */
  async register(dto: RegisterDto) {
    const username = dto.username.trim();
    const existing = await this.prisma.raw.user.findUnique({ where: { username } });
    if (existing) {
      throw new ConflictException('Username is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const organizationId = randomUUID();

    try {
      const user = await this.prisma.raw.$transaction(async (tx) => {
        await tx.organization.create({ data: { id: organizationId, name: dto.organizationName.trim() } });
        const org = { id: organizationId, name: dto.organizationName.trim() };
        const staffCode = await nextStaffCode(tx, org);
        return tx.user.create({
          data: { organizationId, username, passwordHash, role: Role.admin, staffCode },
        });
      });
      return { organizationId, user: { id: user.id, username: user.username, role: user.role } };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Username is already taken');
      }
      throw err;
    }
  }

  /**
   * POST /api/auth/login — username + password → short-lived access token
   * (JWT) + longer-lived opaque refresh token (stored ONLY as a sha-256 hash;
   * the raw value is never persisted). lastLoginAt is stamped on success.
   * Failed logins return the same 401 whether the username or password is
   * wrong — no account-existence oracle.
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.raw.user.findUnique({ where: { username: dto.username.trim() } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const refreshToken = newRefreshToken();
    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: hashRefreshToken(refreshToken), lastLoginAt: new Date() },
    });

    return {
      accessToken: this.signAccessToken(user),
      refreshToken,
      user: { id: user.id, username: user.username, role: user.role, organizationId: user.organizationId },
    };
  }

  /**
   * POST /api/auth/refresh — exchange a valid refresh token for a new access
   * token, rotating the refresh token (new one issued, old one invalidated —
   * a replayed old token no longer matches the stored hash and gets 401).
   */
  async refresh(dto: RefreshDto) {
    const user = await this.prisma.raw.user.findFirst({
      where: { refreshTokenHash: hashRefreshToken(dto.refreshToken) },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const refreshToken = newRefreshToken();
    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: hashRefreshToken(refreshToken) },
    });

    return {
      accessToken: this.signAccessToken(user),
      refreshToken,
      user: { id: user.id, username: user.username, role: user.role, organizationId: user.organizationId },
    };
  }

  /** POST /api/auth/logout — invalidates the presented refresh token (if any). */
  async logout(dto: RefreshDto) {
    await this.prisma.raw.user.updateMany({
      where: { refreshTokenHash: hashRefreshToken(dto.refreshToken) },
      data: { refreshTokenHash: null },
    });
    return { ok: true };
  }

  /** GET /api/auth/me — the current user's profile (from the verified JWT). */
  async me(user: AuthUser) {
    return {
      id: user.userId,
      username: user.username,
      role: user.role,
      organizationId: user.organizationId,
    };
  }

  /** GET /api/users — list all staff in the caller's org (includes staffCode). */
  async listUsers() {
    const organizationId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        staffCode: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * POST /api/users — admin-only staff creation for the CALLER's own org
   * (role gate on the controller; the org comes from the authenticated JWT's
   * tenant context, never from the request body). Public registration can
   * never reach here.
   */
  async createUser(dto: CreateUserDto) {
    const organizationId = this.tenant.requireOrganizationId();
    const username = dto.username.trim();
    const existing = await this.prisma.raw.user.findUnique({ where: { username } });
    if (existing) {
      throw new ConflictException('Username is already taken');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    // Generate staff code inside a transaction for collision safety.
    const org = await this.prisma.raw.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');
    const user = await this.prisma.raw.$transaction(async (tx) => {
      const staffCode = await nextStaffCode(tx, org);
      return tx.user.create({
        data: { organizationId, username, passwordHash, role: dto.role, staffCode },
      });
    });
    return { id: user.id, username: user.username, role: user.role, organizationId: user.organizationId };
  }
}
