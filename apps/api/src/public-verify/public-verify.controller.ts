import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { VerifyReportQueryDto } from './dto/verify-report-query.dto';
import { PublicVerifyService } from './public-verify.service';

/**
 * Public report verification — reachable from a printed QR code: no auth, no
 * session, no tenant header required. The endpoint validates BOTH query
 * params (order number + date of birth) and returns a minimal authenticity
 * payload; the service deliberately returns an identical { valid: false }
 * body for unknown order / not-approved / wrong-DOB so the endpoint can never
 * be used as an existence oracle.
 *
 * @Public() keeps it reachable under the global JwtAuthGuard — the ONE
 * deliberately-unauthenticated data endpoint, same allowlist discipline as
 * the tenant-free raw-client lookup in its service.
 */
@Controller()
export class PublicVerifyController {
  constructor(private readonly publicVerifyService: PublicVerifyService) {}

  @Public()
  @Get('public/verify-report')
  verifyReport(@Query() query: VerifyReportQueryDto) {
    return this.publicVerifyService.verifyReport(query);
  }
}
