import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { UsersController } from './users.controller';

/**
 * Stage 7 real auth. JwtModule is registered GLOBAL so TenantMiddleware (a
 * plain middleware on AppModule, outside any module) can inject JwtService
 * for tenant-context resolution before the guards run. The access token
 * defaults to a 15-minute expiry; JWT_SECRET MUST be set in production —
 * the dev fallback exists only so `npm run dev` works with zero config.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'thulir-dev-secret-do-not-use-in-prod',
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') as JwtSignOptions['expiresIn'] },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService],
})
export class AuthModule {}
