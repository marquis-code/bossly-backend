import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentBusiness, Permissions, RawResponse } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @Permissions(PERMISSIONS.REPORTS_READ)
  dashboard(@CurrentBusiness() businessId: string, @Query() query: ReportQueryDto) {
    return this.reports.dashboard(businessId, query);
  }

  @RawResponse()
  @Get('export/csv')
  @Permissions(PERMISSIONS.REPORTS_READ)
  async csv(@CurrentBusiness() businessId: string, @Query() query: ReportQueryDto, @Res() res: Response) {
    const { filename, csv } = await this.reports.exportCsv(businessId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @RawResponse()
  @Get('export/pdf')
  @Permissions(PERMISSIONS.REPORTS_READ)
  async pdf(@CurrentBusiness() businessId: string, @Query() query: ReportQueryDto, @Res() res: Response) {
    const buffer = await this.reports.exportPdf(businessId, query);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ojaly-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  }
}
