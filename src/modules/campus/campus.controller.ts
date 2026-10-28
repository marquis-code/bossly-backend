import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformRoles } from '../../common/decorators/auth.decorators';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import { CampusService } from './campus.service';
import { ApplyCampusDto, UpdateCampusApplicationDto } from './campus.dto';

@ApiTags('Campus')
@Controller('campus')
export class CampusController {
  constructor(private readonly campus: CampusService) {}

  @Public()
  @Get()
  overview() {
    return this.campus.overview();
  }

  @Public()
  @Post('apply')
  apply(@Body() dto: ApplyCampusDto) {
    return this.campus.apply(dto);
  }
}

@ApiTags('Campus admin')
@ApiBearerAuth()
@SkipTenant()
@PlatformRoles('super_admin', 'support')
@Controller('admin/campus-applications')
export class CampusAdminController {
  constructor(private readonly campus: CampusService) {}

  @Get()
  applications(@Query('status') status?: string) {
    return this.campus.applications(status);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampusApplicationDto) {
    return this.campus.setStatus(id, dto.status);
  }
}
