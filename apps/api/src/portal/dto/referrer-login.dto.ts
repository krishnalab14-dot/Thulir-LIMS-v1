import { IsNotEmpty, IsString } from 'class-validator';

/**
 * POST /api/portal/referrer/login — username + password.
 */
export class ReferrerLoginDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

/**
 * POST /api/portal/patient/refresh, POST /api/portal/referrer/refresh,
 * POST /api/portal/patient/logout, POST /api/portal/referrer/logout
 */
export class PortalRefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
