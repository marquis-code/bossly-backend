import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobsService } from './jobs.service';
import { Subscription, SubscriptionSchema } from '../plans/subscription.schema';
import { Plan, PlanSchema } from '../plans/plan.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { User, UserSchema } from '../users/user.schema';
import { Order, OrderSchema } from '../orders/order.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { DebtsModule } from '../debts/debts.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    DebtsModule,
    ExpensesModule,
    ReceiptsModule,
    PaymentsModule,
    NotificationsModule,
  ],
  providers: [JobsService],
})
export class JobsModule {}
