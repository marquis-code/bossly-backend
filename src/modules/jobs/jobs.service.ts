import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription, SubscriptionDocument } from '../plans/subscription.schema';
import { Plan, PlanDocument } from '../plans/plan.schema';
import { DebtsService } from '../debts/debts.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { paymentFailedEmail } from '../mail/email-templates';
import { ConfigService } from '@nestjs/config';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { Order, OrderDocument } from '../orders/order.schema';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Order.name) private readonly ordersModel: Model<OrderDocument>,
    private readonly debts: DebtsService,
    private readonly expenses: ExpensesService,
    private readonly receipts: ReceiptsService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  @Cron('15 0 * * *', { timeZone: 'Africa/Lagos', name: 'trial-enforcement' })
  async enforceTrials(): Promise<void> {
    try {
      const now = new Date();
      const free = await this.plans.findOne({ isDefault: true }).lean().exec();
      if (!free) return;
      const trials = await this.subscriptions.find({ status: 'trialing' }).limit(500).exec();
      const expiring = [];
      for (const sub of trials) {
        let milestoneReached = Boolean(sub.milestoneReachedAt);
        if (!milestoneReached && sub.trialMilestoneOrders > 0 && sub.trialStartedAt) {
          const count = await this.ordersModel.countDocuments({
            businessId: sub.businessId,
            createdAt: { $gte: sub.trialStartedAt },
          }).exec();
          if (count >= sub.trialMilestoneOrders) {
            sub.milestoneReachedAt = now;
            await sub.save();
            milestoneReached = true;
          }
        }
        if (milestoneReached || (sub.trialEndsAt && sub.trialEndsAt.getTime() <= now.getTime())) {
          expiring.push(sub);
        }
      }
      for (const sub of expiring) {
        await this.subscriptions.updateOne(
          { _id: sub._id },
          {
            $set: {
              planKey: free.key,
              planId: String(free._id),
              status: 'expired',
              adminNote: sub.milestoneReachedAt ? 'Trial usage milestone reached' : 'Trial period ended',
            },
          },
        ).exec();
        await this.notifications.create({
          businessId: sub.businessId,
          type: 'billing',
          title: 'Your trial has ended',
          message: 'Your data is safe. You are now on the free plan — upgrade any time to unlock more products, staff and exports.',
          tone: 'warning',
          data: { planKey: free.key },
          dedupeKey: `trial_ended:${sub.businessId}:${now.toISOString().slice(0, 10)}`,
        });
        const owner = await this.memberships.findOne({ businessId: sub.businessId, role: 'owner' }).lean().exec();
        if (owner) {
          const user = await this.users.findById(owner.userId).lean().exec();
          if (user?.email) {
            const mail = paymentFailedEmail(
              'your business',
              'your Ojaly trial',
              `${this.config.get('appUrl')}/app/settings?tab=billing`,
            );
            void this.mail.send({
              to: user.email,
              subject: 'Your Ojaly trial ended — your data is safe',
              html: mail.html,
              template: 'trial_ended',
              businessId: sub.businessId,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(`Trial enforcement failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('0 7 * * *', { timeZone: 'Africa/Lagos', name: 'debt-reminders' })
  async reminders(): Promise<void> {
    try {
      await this.debts.refreshOverdueStatuses();
      const result = await this.debts.sendScheduledReminders();
      this.logger.log(`Debt reminders sent=${result.sent} failed=${result.failed}`);
    } catch (error) {
      this.logger.error(`Debt reminder job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('5 0 * * *', { timeZone: 'Africa/Lagos', name: 'invoice-statuses' })
  async invoiceStatuses(): Promise<void> {
    try {
      await this.receipts.refreshInvoiceStatuses();
    } catch (error) {
      this.logger.error(`Invoice status job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('*/5 * * * *', { timeZone: 'Africa/Lagos', name: 'recurring-expenses' })
  async recurringExpenses(): Promise<void> {
    try {
      const result = await this.expenses.processRecurring();
      if (result.created) this.logger.log(`Created ${result.created} recurring expense(s)`);
    } catch (error) {
      this.logger.error(`Recurring expense job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('*/15 * * * *', { timeZone: 'Africa/Lagos', name: 'webhook-retries' })
  async webhookRetries(): Promise<void> {
    try {
      const result = await this.payments.retryFailedWebhooks();
      if (result.retried) this.logger.log(`Retried ${result.retried} failed webhook(s)`);
    } catch (error) {
      this.logger.error(`Webhook retry job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}
