import { Body, Controller, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { Roles } from './roles.decorator';

/**
 * POST /api/users — adding staff to an EXISTING organization. Admin-only
 * (403 for every other role). This is the endpoint that must NOT be confused
 * with public registration: it writes into the caller's org under the JWT's
 * tenant context, so a non-admin can never create users anywhere.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Roles(Role.admin)
  @Post()
  createUser(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }
}
