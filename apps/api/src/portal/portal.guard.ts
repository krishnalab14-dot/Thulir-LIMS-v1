import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { PortalJwtPayload, PortalUser } from './portal.types';

/**
 * Stage 8: The portal-specific access-token guard. Applies to patient and
 * referrer portal routes ONLY — it is the MIRROR of JwtAuthGuard: it
 * accepts ONLY tokens with `type: 'patient'` or `type: 'referrer'` and
 * rejects every staff token. This ensures:
 *   - A patient/referrer token can never authorize a staff-only action.
 *   - A staff token can never accidentally authorize a portal-only action.
 *
 * Applied at the controller level on portal controllers (after @Public()
 * disables the global JwtAuthGuard on those routes). On success, sets
 * req.portalUser for the controller/service to read.
 *
 * NOTE: this guard does NOT check @Public() metadata — @Public() is only
 * for the global JwtAuthGuard. This guard always verifies the token.
 */
@Injectable()
export class PortalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & { portalUser?: PortalUser }
    >();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: PortalJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PortalJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.type !== 'patient' && payload.type !== 'referrer') {
      throw new UnauthorizedException('Invalid token type for portal access');
    }

    if (payload.type === 'patient') {
      if (!payload.patientId) {
        throw new UnauthorizedException('Invalid patient token');
      }
      request.portalUser = {
        patientId: payload.patientId,
        organizationId: payload.organizationId,
        type: 'patient',
      };
    } else {
      if (!payload.partyId) {
        throw new UnauthorizedException('Invalid referrer token');
      }
      request.portalUser = {
        partyId: payload.partyId,
        organizationId: payload.organizationId,
        type: 'referrer',
      };
    }

    return true;
  }
}
