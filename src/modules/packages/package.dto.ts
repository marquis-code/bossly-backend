import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateServicePackageDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiProperty()
  @IsString()
  serviceId: string;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  sessions: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  priceKobo: number;

  @ApiPropertyOptional({ default: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  validityDays?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isMembership?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateServicePackageDto extends PartialType(CreateServicePackageDto) {}

export class PackageCheckoutDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  customerName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  customerPhone: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEmail()
  @IsOptional()
  customerEmail?: string;
}

export class PurchasePackageDto extends PackageCheckoutDto {
  @ApiProperty()
  @IsString()
  packageId: string;
}
