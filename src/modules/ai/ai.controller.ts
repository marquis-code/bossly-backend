import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AiService } from './ai.service';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

class ProductCopyDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) imageUrl?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceKobo?: number;
}

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
  ) {}

  @Post('product-description')
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  async productDescription(@CurrentBusiness() businessId: string, @Body() dto: ProductCopyDto) {
    const business = await this.businesses.findById(businessId).select('name').lean().exec();
    return this.ai.productDescription({ ...dto, businessName: business?.name });
  }
}
