import { Module } from '@nestjs/common';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PortalJwtAuthGuard } from './portal.guard';

/**
 * Stage 8: The portal module — patient and referrer self-service portals.
 *
 * Architecture (§0: two different portals, two different login designs):
 *   - Patient login:  mobile + DOB (low-friction, rate-limited)
 *   - Referrer login: admin-issued username + password
 *
 * Both issue stateless JWTs with a `type` discriminator. The global
 * JwtAuthGuard (staff routes) REJECTS portal tokens. The PortalJwtAuthGuard
 * (portal routes) ACCEPTS only portal tokens. The two guards are mutually
 * exclusive — a patient/referrer token can never authorize a staff action,
 * and vice versa.
 */
@Module({
  controllers: [PortalAuthController, PortalController],
  providers: [PortalAuthService, PortalService, PortalJwtAuthGuard],
  exports: [PortalAuthService, PortalJwtAuthGuard],
})
export class PortalModule {}
