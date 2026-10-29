import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshSession, RefreshSessionSchema } from './refresh-session.schema';
import { PhoneSignup, PhoneSignupSchema } from './phone-signup.schema';
import { User, UserSchema } from '../users/user.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { AffiliatesModule } from '../affiliates/affiliates.module';

@Module({
  imports: [
    JwtModule.register({}),
    AffiliatesModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: RefreshSession.name, schema: RefreshSessionSchema },
      { name: PhoneSignup.name, schema: PhoneSignupSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, MongooseModule],
})
export class AuthModule {}
