import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PortalAuthService } from './portal-auth.service';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PortalRefreshDto, ReferrerLoginDto } from './dto/referrer-login.dto';

/**
 * Stage 8: Portal authentication controller. All login/refresh/logout
 * endpoints are @Public() — the user must authenticate without being
 * authenticated. The PortalJwtAuthGuard is NOT used here (it's for
 * protected portal routes); these endpoints verify credentials directly
 * in the service.
 *
 * Patient login: mobile + DOB (two-factor, low-friction, same pattern as
 * Stage 6's public verify). Rate-limited (5 per 15 min per mobile).
 *
 * Referrer login: username + password (admin-issued credentials).
 */
@Controller('portal')
export class PortalAuthController {
  constructor(private readonly portalAuth: PortalAuthService) {}

  // -- Patient endpoints --

  @Public()
  @Post('patient/login')
  patientLogin(@Body() dto: PatientLoginDto) {
    return this.portalAuth.patientLogin(dto.mobile, dto.dob);
  }

  @Public()
  @Post('patient/refresh')
  patientRefresh(@Body() dto: PortalRefreshDto) {
    return this.portalAuth.patientRefresh(dto.refreshToken);
  }

  @Public()
  @Post('patient/logout')
  patientLogout(@Body() dto: PortalRefreshDto) {
    return this.portalAuth.patientLogout(dto.refreshToken);
  }

  // -- Referrer endpoints --

  @Public()
  @Post('referrer/login')
  referrerLogin(@Body() dto: ReferrerLoginDto) {
    return this.portalAuth.referrerLogin(dto.username, dto.password);
  }

  @Public()
  @Post('referrer/refresh')
  referrerRefresh(@Body() dto: PortalRefreshDto) {
    return this.portalAuth.referrerRefresh(dto.refreshToken);
  }

  @Public()
  @Post('referrer/logout')
  referrerLogout(@Body() dto: PortalRefreshDto) {
    return this.portalAuth.referrerLogout(dto.refreshToken);
  }
}
