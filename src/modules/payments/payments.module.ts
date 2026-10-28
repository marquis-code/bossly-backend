import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import { Payment, PaymentSchema } from './payment.schema';
import { WebhookEvent, WebhookEventSchema } from './webhook-event.schema';
import { Order, OrderSchema } from '../orders/order.schema';
import { Debt, DebtSchema } from '../debts/debt.schema';
import { Invoice, InvoiceSchema } from '../receipts/invoice.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { User, UserSchema } from '../users/user.schema';
import { Subscription, SubscriptionSchema } from '../plans/subscription.schema';
import { Coupon, CouponSchema } from '../plans/coupon.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { OrdersModule } from '../orders/orders.module';
import { DebtsModule } from '../debts/debts.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: WebhookEvent.name, schema: WebhookEventSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Debt.name, schema: DebtSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: User.name, schema: UserSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    OrdersModule,
    DebtsModule,
    AffiliatesModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaystackService],
  exports: [PaymentsService, PaystackService],
})
export class PaymentsModule {}
