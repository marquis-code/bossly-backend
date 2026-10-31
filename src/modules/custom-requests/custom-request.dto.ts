import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCustomRequestDto {
  @ApiProperty() @IsString() serviceId: string;
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(100) customerName: string;
  @ApiProperty() @IsString() @MaxLength(30) customerPhone: string;
  @ApiPropertyOptional() @IsEmail() @IsOptional() customerEmail?: string;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(120) style?: string;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(80) length?: string;
  @ApiPropertyOptional({ enum: ['vendor', 'client', 'not_sure'] }) @IsIn(['vendor', 'client', 'not_sure']) @IsOptional() hairOption?: 'vendor' | 'client' | 'not_sure';
  @ApiPropertyOptional() @IsString() @IsOptional() preferredDate?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() preferredTime?: string;
  @ApiPropertyOptional() @IsInt() @Min(0) @IsOptional() budgetKobo?: number;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ type: [String] }) @IsArray() @ArrayMaxSize(3) @IsUrl({ require_protocol: true }, { each: true }) @IsOptional() referenceUrls?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsArray() @ArrayMaxSize(3) @IsUrl({ require_protocol: true }, { each: true }) @IsOptional() referenceImages?: string[];
}

export class CustomRequestMessageDto {
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(2000) body: string;
}

export class CustomQuoteItemDto {
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(80) label: string;
  @ApiProperty() @IsInt() @Min(0) amountKobo: number;
}

export class CreateCustomQuoteDto {
  @ApiProperty({ type: [CustomQuoteItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => CustomQuoteItemDto) items: CustomQuoteItemDto[];
  @ApiProperty() @IsInt() @Min(1) durationMinutes: number;
  @ApiProperty() @IsInt() @Min(0) depositKobo: number;
  @ApiPropertyOptional() @IsISO8601() @IsOptional() startAt?: string;
  @ApiPropertyOptional({ type: [String] }) @IsArray() @ArrayMaxSize(4) @IsISO8601({}, { each: true }) @IsOptional() slots?: string[];
  @ApiPropertyOptional() @IsString() @IsOptional() providerId?: string;
  @ApiPropertyOptional() @Transform(trim) @IsString() @IsOptional() @MaxLength(1000) note?: string;
  @ApiPropertyOptional() @IsInt() @Min(1) @Max(168) @IsOptional() expiresInHours?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @IsOptional() serviceKobo?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @IsOptional() hairKobo?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @IsOptional() addOnKobo?: number;
}

export class AcceptCustomQuoteDto {
  @ApiPropertyOptional() @IsISO8601() @IsOptional() startAt?: string;
}
