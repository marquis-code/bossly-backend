import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { User, UserDocument } from '../modules/users/user.schema';
import { Business, BusinessDocument } from '../modules/businesses/business.schema';
import { PlansService } from '../modules/plans/plans.service';
import { AuthService } from '../modules/auth/auth.service';
import { ProductsService } from '../modules/products/products.service';
import { SalesService } from '../modules/sales/sales.service';
import { ExpensesService } from '../modules/expenses/expenses.service';
import { DebtsService } from '../modules/debts/debts.service';
import { Product, ProductDocument } from '../modules/products/product.schema';

async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const config = app.get(ConfigService);
  const mediaBase = (config.get<string>('appUrl') || 'http://localhost:3100').replace(/\/$/, '');
  const users = app.get<Model<UserDocument>>(getModelToken(User.name));
  const productModel = app.get<Model<ProductDocument>>(getModelToken(Product.name));
  const businesses = app.get<Model<BusinessDocument>>(getModelToken(Business.name));
  const plans = app.get(PlansService);
  const auth = app.get(AuthService);
  const products = app.get(ProductsService);
  const sales = app.get(SalesService);
  const expenses = app.get(ExpensesService);
  const debts = app.get(DebtsService);

  await plans.ensureDefaults();

  const adminEmail = (config.get<string>('seed.email') || 'admin@ojaly.org').toLowerCase();
  const adminPassword = config.get<string>('seed.password') || 'ChangeMe123!';
  let admin = await users.findOne({ email: adminEmail }).exec();
  if (!admin) {
    admin = await users.create({
      name: 'Ojaly Admin',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
      platformRole: 'super_admin',
      emailVerifiedAt: new Date(),
    });
    console.log(`✓ Super admin: ${adminEmail}`);
  } else {
    if (!admin.platformRole) {
      admin.platformRole = 'super_admin';
      await admin.save();
    }
    console.log(`• Super admin already exists: ${adminEmail}`);
  }

  const isProduction = (process.env.NODE_ENV || 'development') === 'production';
  if (isProduction) {
    if (!process.env.SEED_SUPER_ADMIN_EMAIL || !process.env.SEED_SUPER_ADMIN_PASSWORD) {
      throw new Error('Production seed requires SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD.');
    }
    if (process.env.SEED_SUPER_ADMIN_PASSWORD === 'ChangeMe123!' || process.env.SEED_SUPER_ADMIN_PASSWORD.length < 12) {
      throw new Error('Production seed requires a unique admin password of at least 12 characters. Do not use the development default.');
    }
  }
  const demoEnabled = process.env.SEED_DEMO === 'true' || (process.env.SEED_DEMO !== 'false' && !isProduction);
  if (demoEnabled) {
    const demoEmail = 'demo@ojaly.org';
    const existing = await businesses.findOne({ email: demoEmail }).lean().exec();
    if (existing) {
      console.log(`• Demo business already exists: /s/${existing.slug}`);
    } else {
      const result = await auth.register(
        {
          name: 'Tola Adeyemi',
          email: demoEmail,
          password: 'Demo12345',
          businessName: 'Tola Thrift',
          category: 'fashion',
          phone: '08031234567',
        },
        { ip: '127.0.0.1', userAgent: 'Ojaly seed' },
      );
      const businessId = result.activeBusinessId as string;
      await businesses.updateOne(
        { _id: businessId },
        {
          $set: {
            tagline: 'Campus fits. Thrift prices. Zero stress.',
            description: 'Hand-picked thrift and streetwear for students who want to look expensive on a student budget.',
            about: 'Tola Thrift started in a Unilag hostel room with one bag of vintage tees. Today we style students across Lagos with fresh drops every Friday. Every order is packed with love and a small surprise.',
            brandColor: '#FF5A1F',
            templateKey: 'lagos-pop',
            storefrontPublished: true,
            publishedAt: new Date(),
            seoTitle: 'Tola Thrift — campus fits, thrift prices',
            seoDescription: 'Shop hand-picked thrift and streetwear for Nigerian students. Fresh drops every Friday.',
            address: 'Akoka, Lagos',
            publicPhone: '08031234567',
            whatsappNumber: '08031234567',
            socialLinks: { instagram: 'https://instagram.com/tolathrift', tiktok: 'https://tiktok.com/@tolathrift' },
            bannerUrl: `${mediaBase}/demo/hero.svg`,
            storyImageUrl: `${mediaBase}/demo/story.svg`,
            lookbookTitle: 'The Friday drop',
            lookbook: [
              { url: `${mediaBase}/demo/lookbook-1.svg`, caption: 'Lecture hall fit — hoodie, cap, no stress.' },
              { url: `${mediaBase}/demo/lookbook-2.svg`, caption: 'Market run at Yaba. Early starts, good finds.' },
              { url: `${mediaBase}/demo/lookbook-3.svg`, caption: 'Good energy only. Limited pieces, packed by hand.' },
            ],
            firstProfitAt: new Date(),
          },
        },
      ).exec();
      const p1 = await products.create(result.user.id, businessId, {
        name: 'Oversized Campus Hoodie',
        description: 'Heavyweight cotton hoodie with a boxy fit. Perfect for 8am lectures and 8pm plans.',
        category: 'Hoodies',
        sku: 'HOOD-BLK',
        images: [`${mediaBase}/demo/hoodie.svg`],
        priceKobo: 1250000,
        costPriceKobo: 720000,
        quantity: 14,
        lowStockThreshold: 3,
        variants: [
          { name: 'Black / M', attributes: { colour: 'Black', size: 'M' }, priceKobo: 1250000, costPriceKobo: 720000, quantity: 6, lowStockThreshold: 2, sku: 'HOOD-BLK-M' },
          { name: 'Black / L', attributes: { colour: 'Black', size: 'L' }, priceKobo: 1250000, costPriceKobo: 720000, quantity: 5, lowStockThreshold: 2, sku: 'HOOD-BLK-L' },
          { name: 'Cream / M', attributes: { colour: 'Cream', size: 'M' }, priceKobo: 1300000, costPriceKobo: 750000, quantity: 3, lowStockThreshold: 2, sku: 'HOOD-CRM-M' },
        ],
        tags: ['hoodie', 'streetwear'],
      });
      const p2 = await products.create(result.user.id, businessId, {
        name: 'Vintage Wash Cap',
        description: 'Unstructured six-panel cap, faded wash, adjustable strap.',
        category: 'Accessories',
        sku: 'CAP-VINT',
        images: [`${mediaBase}/demo/cap.svg`],
        priceKobo: 450000,
        costPriceKobo: 210000,
        quantity: 22,
        lowStockThreshold: 5,
        tags: ['cap', 'accessories'],
      });
      const p3 = await products.create(result.user.id, businessId, {
        name: 'Unilag 200-level Tee',
        description: 'Soft cotton tee with a subtle campus print. Limited run.',
        category: 'Tees',
        sku: 'TEE-200',
        images: [`${mediaBase}/demo/tee.svg`],
        priceKobo: 750000,
        costPriceKobo: 380000,
        quantity: 2,
        lowStockThreshold: 4,
        tags: ['tee', 'campus'],
      });
      const p1Doc = await productModel.findById(p1.id).exec();
      const p2Doc = await productModel.findById(p2.id).exec();
      const p3Doc = await productModel.findById(p3.id).exec();
      if (!p1Doc || !p2Doc || !p3Doc) throw new Error('Seed products failed to load');
      const hoodieVariant = p1Doc.variants[0];
      const capVariant = p2Doc.variants[0];
      await sales.create(result.user.id, businessId, {
        customerName: 'Tola Bakare',
        customerPhone: '08122334455',
        items: [
          { productId: p1Doc._id.toString(), variantId: hoodieVariant._id!.toString(), quantity: 1 },
          { productId: p2Doc._id.toString(), variantId: capVariant._id!.toString(), quantity: 1 },
        ],
        amountPaidKobo: 1200000,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        paymentMethod: 'transfer',
        notes: 'Paid part, balance next week',
      });
      await sales.create(result.user.id, businessId, {
        customerName: 'Amaka Obi',
        customerPhone: '09033445566',
        items: [{ productId: p3Doc._id.toString(), quantity: 1 }],
        amountPaidKobo: 750000,
        paymentMethod: 'cash',
      });
      await expenses.create(result.user.id, businessId, {
        category: 'transport',
        amountKobo: 350000,
        date: new Date().toISOString(),
        notes: 'Bus to Yaba market and back',
      });
      await expenses.create(result.user.id, businessId, {
        category: 'packaging',
        amountKobo: 125000,
        date: new Date().toISOString(),
        notes: 'Branded bags and tissue paper',
      });
      await expenses.create(result.user.id, businessId, {
        category: 'data',
        amountKobo: 50000,
        date: new Date().toISOString(),
        notes: 'Monthly data for WhatsApp orders',
        recurrence: 'monthly',
      });
      const demoDebts = await debts.list(businessId, { page: 1, limit: 5 });
      console.log(`✓ Demo storefront: ${mediaBase}/s/${(await businesses.findById(businessId).lean().exec())?.slug}`);
      console.log(`✓ Demo login: ${demoEmail} / Demo12345`);
      console.log(`✓ Demo data: ${products ? '3 products' : ''}, 2 sales, 1 debt (${demoDebts.items.length} in ledger), 3 expenses`);
    }
  }

  console.log('');
  console.log('Seed complete.');
  console.log(isProduction ? `Admin: ${adminEmail}` : `Admin: ${adminEmail} / ${adminPassword}`);
  await app.close();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
