import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer, CustomerSchema } from './customer.schema';
import { Sale, SaleSchema } from '../sales/sale.schema';
import { Debt, DebtSchema } from '../debts/debt.schema';
import { Order, OrderSchema } from '../orders/order.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Sale.name, schema: SaleSchema },
      { name: Debt.name, schema: DebtSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService, MongooseModule],
})
export class CustomersModule {}
