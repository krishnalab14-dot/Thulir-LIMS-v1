import { Controller, ForbiddenException, Get, Param, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PortalJwtAuthGuard } from './portal.guard';
import { CurrentPortalUser } from './portal-user.decorator';
import { PortalService } from './portal.service';
import type { PortalUser } from './portal.types';

/**
 * Stage 8: Patient & Referrer portal data endpoints — authenticated surfaces.
 *
 * @Public() at the CLASS level disables the global JwtAuthGuard (so portal
 * tokens — which carry type: 'patient' | 'referrer' — are not rejected by
 * the staff guard). PortalJwtAuthGuard at the CLASS level then verifies the
 * portal token and sets req.portalUser. Ownership is enforced per-handler
 * in the service layer. Per-route type enforcement ensures a patient token
 * cannot access referrer routes and vice versa.
 *
 * This class shares the /portal prefix with PortalAuthController (login/
 * refresh/logout), but they are separate NestJS controllers — NestJS
 * dispatches by matching the full route path.
 */
@Public()
@UseGuards(PortalJwtAuthGuard)
@Controller('portal')
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  /** Type guard: rejects if the token type doesn't match the expected route. */
  private requireType<T extends 'patient' | 'referrer'>(user: PortalUser, expected: T): PortalUser & { type: T } {
    if (user.type !== expected) {
      throw new ForbiddenException(
        expected === 'patient'
          ? 'Patient portal access required'
          : 'Referrer portal access required',
      );
    }
    return user as PortalUser & { type: T };
  }

  // ---------------------------------------------------------------------------
  // Patient portal routes
  // ---------------------------------------------------------------------------

  @Get('patient/orders')
  getPatientOrders(@CurrentPortalUser() user: PortalUser) {
    return this.portalService.getPatientOrders(this.requireType(user, 'patient'));
  }

  @Get('patient/orders/:id/report')
  getPatientReport(
    @CurrentPortalUser() user: PortalUser,
    @Param('id') id: string,
  ) {
    return this.portalService.getPatientReport(this.requireType(user, 'patient'), id);
  }

  // ---------------------------------------------------------------------------
  // Referrer portal routes
  // ---------------------------------------------------------------------------

  @Get('referrer/orders')
  getReferrerOrders(@CurrentPortalUser() user: PortalUser) {
    return this.portalService.getReferrerOrders(this.requireType(user, 'referrer'));
  }

  @Get('referrer/orders/:id/report')
  getReferrerReport(
    @CurrentPortalUser() user: PortalUser,
    @Param('id') id: string,
  ) {
    return this.portalService.getReferrerReport(this.requireType(user, 'referrer'), id);
  }
}
