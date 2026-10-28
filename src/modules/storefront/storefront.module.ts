import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorefrontController, StorefrontInboxController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { StorefrontMessage, StorefrontMessageSchema } from './storefront-message.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Product, ProductSchema } from '../products/product.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { User, UserSchema } from '../users/user.schema';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServicesModule } from '../services/services.module';
import { ProvidersModule } from '../providers/providers.module';
import { BookingsModule } from '../bookings/bookings.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { PackagesModule } from '../packages/packages.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StorefrontMessage.name, schema: StorefrontMessageSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: User.name, schema: UserSchema },
    ]),
    OrdersModule,
    PaymentsModule,
    NotificationsModule,
    ServicesModule,
    ProvidersModule,
    BookingsModule,
    WaitlistModule,
    ReviewsModule,
    PackagesModule,
  ],
  controllers: [StorefrontController, StorefrontInboxController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
