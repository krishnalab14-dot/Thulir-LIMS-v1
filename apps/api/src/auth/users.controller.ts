import { Body, Controller, Get, Post } from '@nestjs/common';
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

  /** GET /api/users — list all staff in the caller's org. */
  @Get()
  listUsers() {
    return this.auth.listUsers();
  }

  @Roles(Role.admin)
  @Post()
  createUser(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }
}
