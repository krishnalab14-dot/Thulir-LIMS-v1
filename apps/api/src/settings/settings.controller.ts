import { Body, Controller, Get, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('organization')
  getOrgSettings() {
    return this.settings.getOrgSettings();
  }

  @Roles(Role.admin, Role.lab_manager)
  @Put('organization')
  updateOrgSettings(@Body() dto: UpdateOrgSettingsDto) {
    return this.settings.updateOrgSettings(dto);
  }
}
