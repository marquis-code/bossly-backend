import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { User, UserSchema } from '../users/user.schema';
import { Provider, ProviderSchema } from './provider.schema';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Provider.name, schema: ProviderSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: User.name, schema: UserSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [ProvidersController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
