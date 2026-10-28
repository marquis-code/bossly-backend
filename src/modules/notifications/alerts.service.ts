import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { WhatsappContact, WhatsappContactDocument } from '../whatsapp/whatsapp-contact.schema';
import { MailService } from '../mail/mail.service';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { NotificationsService } from './notifications.service';
import { lowStockEmail } from '../mail/email-templates';
import { formatNaira } from '../../common/utils/money';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(WhatsappContact.name) private readonly contacts: Model<WhatsappContactDocument>,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappClientService,
    private readonly config: ConfigService,
  ) {}

  async checkVariantLowStock(businessId: string, productId: string, variantId: string): Promise<void> {
    const product = await this.products.findOne({ _id: productId, businessId }).exec();
    if (!product) return;
    const variant = product.variants.find((v) => v._id?.toString() === variantId);
    if (!variant) return;
    const isLow = variant.isActive && variant.quantity <= variant.lowStockThreshold;
    if (!isLow) {
      if (variant.lowStockAlertActive) {
        variant.lowStockAlertActive = false;
        variant.lastLowStockAlertAt = null;
        await product.save();
      }
      return;
    }
    const debounceMs = 24 * 3600 * 1000;
    if (variant.lowStockAlertActive && variant.lastLowStockAlertAt && Date.now() - variant.lastLowStockAlertAt.getTime() < debounceMs) {
      return;
    }
    variant.lowStockAlertActive = true;
    variant.lastLowStockAlertAt = new Date();
    await product.save();

    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) return;
    const settings = business.alertSettings || {};
    const label = product.variants.length > 1 ? `${product.name} — ${variant.name}` : product.name;
    const dashboardUrl = `${this.config.get('appUrl')}/app/stock`;

    if (settings.lowStockInApp !== false) {
      await this.notifications.create({
        businessId,
        type: 'low_stock',
        title: variant.quantity <= 0 ? `${label} is out of stock` : `${label} is running low`,
        message:
          variant.quantity <= 0
            ? `You have 0 left. Restock so customers can keep buying.`
            : `Only ${variant.quantity} left (you alert at ${variant.lowStockThreshold}). Restock soon.`,
        tone: variant.quantity <= 0 ? 'danger' : 'warning',
        data: { productId, variantId, quantity: variant.quantity },
        channels: ['in_app'],
        dedupeKey: `low_stock:${productId}:${variantId}:${new Date().toISOString().slice(0, 10)}`,
      });
    }

    const owner = await this.memberships.findOne({ businessId, role: 'owner', status: 'active' }).lean().exec();
    if (!owner) return;
    const ownerUser = await this.users.findById(owner.userId).lean().exec();

    if (settings.lowStockEmail !== false && ownerUser?.email && ownerUser.notificationPrefs?.lowStock !== false) {
      const mail = lowStockEmail(
        business.name,
        [{ name: label, remaining: variant.quantity }],
        dashboardUrl,
        business.logoUrl,
        business.tagline,
      );
      void this.mail.send({
        to: ownerUser.email,
        subject: mail.subject,
        html: mail.html,
        template: 'low_stock',
        businessId,
      });
    }

    if (settings.lowStockWhatsapp !== false) {
      const contact = await this.contacts.findOne({ userId: owner.userId, verifiedAt: { $ne: null } }).lean().exec();
      if (contact) {
        const message = `⚠️ *Low stock at ${business.name}*\n\n${label}: ${variant.quantity <= 0 ? 'OUT OF STOCK' : `${variant.quantity} left`}\nSelling price: ${formatNaira(variant.priceKobo)}\n\nRestock now: ${dashboardUrl}`;
        void this.whatsapp.send({
          businessId,
          phone: contact.phone,
          text: message,
          template: {
            name: 'ojaly_low_stock',
            language: 'en',
            params: [business.name, label, variant.quantity <= 0 ? '0' : String(variant.quantity)],
          },
        });
      }
    }
  }

  async checkMany(businessId: string, refs: { productId: string; variantId: string }[]): Promise<void> {
    for (const ref of refs) {
      try {
        await this.checkVariantLowStock(businessId, ref.productId, ref.variantId);
      } catch (error) {
        this.logger.warn(`Low-stock check failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  }
}
