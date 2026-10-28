import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformRoles } from '../../common/decorators/auth.decorators';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import { CampusService } from './campus.service';
import { ApplyCampusDto, UpdateCampusApplicationDto } from './campus.dto';

class CreatePayoutDto {
  @Type(() => Number)
  @IsInt()
  @Min(100)
  amountKobo: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

class UpdatePayoutDto {
  @IsIn(['pending', 'paid', 'cancelled'])
  status: 'pending' | 'paid' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

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

  @Get(':id/payouts')
  payouts(@Param('id') id: string) {
    return this.campus.payouts(id);
  }

  @Post(':id/payouts')
  createPayout(@Param('id') id: string, @Body() dto: CreatePayoutDto) {
    return this.campus.createPayout(id, dto.amountKobo, dto.note);
  }
}

@ApiTags('Campus admin')
@ApiBearerAuth()
@SkipTenant()
@PlatformRoles('super_admin', 'support')
@Controller('admin/campus-payouts')
export class CampusPayoutAdminController {
  constructor(private readonly campus: CampusService) {}

  @Get()
  payouts(@Query('applicationId') applicationId?: string) {
    return this.campus.payouts(applicationId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePayoutDto) {
    return this.campus.updatePayout(id, dto.status, dto.reference);
  }
}
