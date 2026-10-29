import { Body, Controller, Get, Ip, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthResponse } from './auth.service';
import {
  ChangePasswordDto,
  PhoneStartDto,
  PhoneVerifyDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchBusinessDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private meta(req: Request, ip: string) {
    return { ip, userAgent: req.headers['user-agent']?.slice(0, 300) };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account, business and free storefront' })
  register(@Body() dto: RegisterDto, @Req() req: Request, @Ip() ip: string): Promise<AuthResponse> {
    return this.auth.register(dto, this.meta(req, ip));
  }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @Post('phone/start')
  phoneStart(@Body() dto: PhoneStartDto) {
    return this.auth.startPhoneSignup(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('phone/verify')
  phoneVerify(@Body() dto: PhoneVerifyDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.verifyPhoneSignup(dto, this.meta(req, ip));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request, @Ip() ip: string): Promise<AuthResponse> {
    return this.auth.login(dto, this.meta(req, ip));
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @Post('platform/login')
  platformLogin(@Body() dto: LoginDto, @Req() req: Request, @Ip() ip: string): Promise<AuthResponse> {
    return this.auth.login(dto, this.meta(req, ip), true);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request, @Ip() ip: string): Promise<AuthResponse> {
    return this.auth.refresh(dto, this.meta(req, ip));
  }

  @ApiBearerAuth()
  @SkipTenant()
  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogoutDto) {
    return this.auth.logout(user, dto);
  }

  @ApiBearerAuth()
  @SkipTenant()
  @Post('switch-business')
  switchBusiness(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchBusinessDto,
    @Req() req: Request,
    @Ip() ip: string,
  ): Promise<AuthResponse> {
    return this.auth.switchBusiness(user, dto, this.meta(req, ip));
  }

  @ApiBearerAuth()
  @SkipTenant()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @SkipTenant()
  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  @ApiBearerAuth()
  @SkipTenant()
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto);
  }

  @ApiBearerAuth()
  @SkipTenant()
  @Post('resend-verification')
  resendVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.resendVerification(user);
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }
}
