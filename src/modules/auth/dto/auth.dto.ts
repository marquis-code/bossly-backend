import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @ApiProperty({ example: 'Tola Adeyemi' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiProperty({ example: 'tola@unilag.edu.ng' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @ApiProperty({ example: 'StrongPass123' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'Password needs at least one letter and one number.' })
  password: string;

  @ApiProperty({ example: 'Tola Thrift' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  businessName: string;

  @ApiPropertyOptional({ example: 'thrift' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ example: 'wig installation' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  customCategory?: string;

  @ApiPropertyOptional({ example: 'starter' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  plan?: string;

  @ApiPropertyOptional({ example: 'services', enum: ['products', 'services', 'hybrid'] })
  @IsIn(['products', 'services', 'hybrid'])
  @IsOptional()
  businessMode?: 'products' | 'services' | 'hybrid';

  @ApiPropertyOptional({ example: 'Yaba, Lagos' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  address?: string;

  @ApiPropertyOptional({ example: '08031234567' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'UNILAG-AB12' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  ambassador?: string;

  @ApiPropertyOptional({ example: 'UNILAG' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  campus?: string;

  @ApiPropertyOptional({ example: 'LAG-REF-123' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  referral?: string;
}

export class LoginDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken: string;
}

export class LogoutDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'Password needs at least one letter and one number.' })
  password: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  token: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'Password needs at least one letter and one number.' })
  newPassword: string;
}

export class SwitchBusinessDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  businessId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @IsOptional()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}


export class PhoneStartDto {
  @ApiProperty({ example: '08031234567' })
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  businessName?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ example: 'wig installation' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  customCategory?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  address?: string;

  @ApiPropertyOptional({ enum: ['products', 'services', 'hybrid'] })
  @IsIn(['products', 'services', 'hybrid'])
  @IsOptional()
  businessMode?: 'products' | 'services' | 'hybrid';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  campus?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ambassador?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  referral?: string;
}

export class PhoneVerifyDto {
  @ApiProperty()
  @IsString()
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;
}
