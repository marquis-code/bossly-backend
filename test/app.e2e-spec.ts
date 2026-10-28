import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { createHmac, randomUUID } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Payment, PaymentDocument } from '../src/modules/payments/payment.schema';
import { Order, OrderDocument } from '../src/modules/orders/order.schema';
import { WhatsappMessage, WhatsappMessageDocument } from '../src/modules/whatsapp/whatsapp-message.schema';

describe('Ojaly API (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryReplSet;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  const paystackWebhookSecret = 'whsec_ojaly_e2e_secret';

  const registered: Array<{ token: string; refreshToken: string; businessId: string; email: string; slug: string }> = [];

  beforeAll(async () => {
    process.env.MONGOMS_DOWNLOAD_DIR = resolve(__dirname, '../.cache/mongodb-binaries');
    const cachedDir = resolve(__dirname, '../../../node_modules/.cache/mongodb-memory-server');
    if (existsSync(cachedDir)) {
      const binary = readdirSync(cachedDir).find((file) => file.startsWith('mongod'));
      if (binary) process.env.MONGOMS_SYSTEM_BINARY = join(cachedDir, binary);
    }
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const uri = mongod.getUri('ojaly-e2e');
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '0',
      MONGODB_URI: uri,
      JWT_ACCESS_SECRET: 'test-access-secret-012345678901234567890123',
      JWT_REFRESH_SECRET: 'test-refresh-secret-01234567890123456789012',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      APP_URL: 'http://localhost:3100',
      API_URL: 'http://localhost:4100/api/v1',
      PUBLIC_ROOT_DOMAIN: 'ojaly.ng',
      ALLOWED_ORIGINS: 'http://localhost:3100',
      PAYSTACK_SECRET_KEY: 'sk_test_ojaly_e2e',
      PAYSTACK_WEBHOOK_SECRET: paystackWebhookSecret,
      WHATSAPP_VERIFY_TOKEN: 'verify-e2e',
      WHATSAPP_APP_SECRET: 'whatsapp-e2e-secret',
      RESEND_API_KEY: '',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
    await app.init();
    http = request(app.getHttpServer());
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  }, 60000);

  async function register(extra = '') {
    const email = `e2e-${run}-${registered.length + 1}-${extra}@example.com`.replace(/[^a-z0-9@.-]/gi, '');
    const response = await http.post('/api/v1/auth/register').send({
      name: 'E2E Owner',
      email,
      password: 'Testing123',
      businessName: `E2E Business ${registered.length + 1} ${extra}`.trim(),
      category: 'fashion',
      phone: '08031234567',
    });
    if (response.status !== 201) throw new Error(`Register failed ${response.status}: ${JSON.stringify(response.body)}`);
    const data = response.body.data;
    const account = {
      token: data.accessToken as string,
      refreshToken: data.refreshToken as string,
      businessId: data.activeBusinessId as string,
      email,
      slug: data.businesses[0].slug as string,
    };
    registered.push(account);
    return account;
  }

  async function createProduct(account: (typeof registered)[number]) {
    const response = await http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ name: `E2E Hoodie ${run}`, category: 'Hoodies', priceKobo: 1000000, costPriceKobo: 600000, quantity: 10, lowStockThreshold: 2, sku: `E2E-${run}-${registered.length}-${Math.random().toString(36).slice(2, 5)}` });
    expect(response.status).toBe(201);
    return response.body.data as { id: string; variants: Array<{ id: string; quantity: number }>; quantity: number };
  }

  describe('Auth & tenancy', () => {
    let account: (typeof registered)[number];
    it('registers a business, owner membership and trial', async () => {
      account = await register('auth');
      const me = await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${account.token}`);
      expect(me.status).toBe(200);
      expect(me.body.data.user.email).toBe(account.email);
      expect(me.body.data.user.emailVerified).toBe(false);
      expect(me.body.data.businesses).toHaveLength(1);
      expect(me.body.data.activeBusinessId).toBe(account.businessId);
      expect(JSON.stringify(me.body)).not.toContain('passwordHash');
    });

    it('rejects duplicate emails with a clean conflict', async () => {
      const response = await http.post('/api/v1/auth/register').send({
        name: 'Duplicate', email: account.email, password: 'Testing123', businessName: 'Another Shop', category: 'food',
      });
      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBeDefined();
    });

    it('rejects a bad password and accepts a good one', async () => {
      const bad = await http.post('/api/v1/auth/login').send({ email: account.email, password: 'WrongPass123' });
      expect(bad.status).toBe(401);
      const good = await http.post('/api/v1/auth/login').send({ email: account.email, password: 'Testing123' });
      expect(good.status).toBe(201);
      expect(good.body.data.accessToken).toBeDefined();
    });

    it('rotates refresh tokens and invalidates the old one', async () => {
      const first = await http.post('/api/v1/auth/refresh').send({ refreshToken: account.refreshToken });
      expect(first.status).toBe(201);
      expect(first.body.data.accessToken).toBeDefined();
      expect(first.body.data.refreshToken).not.toBe(account.refreshToken);
      const reused = await http.post('/api/v1/auth/refresh').send({ refreshToken: account.refreshToken });
      expect(reused.status).toBe(401);
      account.token = first.body.data.accessToken;
      account.refreshToken = first.body.data.refreshToken;
    });

    it('blocks unauthenticated access to tenant routes', async () => {
      const response = await http.get('/api/v1/products');
      expect(response.status).toBe(401);
    });
  });

  describe('Orders, stock and sales', () => {
    let owner: (typeof registered)[number];
    let other: (typeof registered)[number];
    let product: Awaited<ReturnType<typeof createProduct>>;

    it('sets up two isolated businesses', async () => {
      owner = await register('orders');
      other = await register('other');
      product = await createProduct(owner);
      expect(product.variants).toHaveLength(1);
      expect(product.quantity).toBe(10);
    });

    it('creates an order, reduces stock and exposes it only to its tenant', async () => {
      const response = await http.post('/api/v1/orders').set('Authorization', `Bearer ${owner.token}`).send({
        customerName: 'E2E Buyer', customerPhone: '08055550123', items: [{ productId: product.id, variantId: product.variants[0].id, quantity: 2 }],
        dueDate: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(response.status).toBe(201);
      const order = response.body.data;
      expect(order.status).toBe('pending');
      expect(order.orderNumber).toMatch(/^ORD-/);
      const refreshed = await http.get(`/api/v1/products/${product.id}`).set('Authorization', `Bearer ${owner.token}`);
      expect(refreshed.body.data.quantity).toBe(8);
      const foreign = await http.get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${other.token}`);
      expect(foreign.status).toBe(404);
      const own = await http.get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${owner.token}`);
      expect(own.status).toBe(200);
    });

    it('confirms the order and creates the sale exactly once', async () => {
      const orders = await http.get('/api/v1/orders').set('Authorization', `Bearer ${owner.token}`);
      const orderId = orders.body.data.items[0].id;
      const confirmed = await http.post(`/api/v1/orders/${orderId}/confirm`).set('Authorization', `Bearer ${owner.token}`);
      expect(confirmed.status).toBe(201);
      expect(confirmed.body.data.saleId).toBeTruthy();
      expect(confirmed.body.data.debtId).toBeTruthy();
      const again = await http.post(`/api/v1/orders/${orderId}/confirm`).set('Authorization', `Bearer ${owner.token}`);
      expect(again.status).toBe(201);
      const sales = await http.get('/api/v1/sales').set('Authorization', `Bearer ${owner.token}`);
      expect(sales.body.data.items).toHaveLength(1);
      expect(sales.body.data.items[0].totalKobo).toBe(2000000);
      expect(sales.body.data.items[0].grossProfitKobo).toBe(800000);
    });
  });

  describe('WhatsApp bot, linking and undo', () => {
    let account: (typeof registered)[number];
    let product: Awaited<ReturnType<typeof createProduct>>;
    const phone = '2348066667777';
    const appSecret = 'whatsapp-e2e-secret';
    let messageCounter = 0;

    async function whatsappWebhook(text: string) {
      const id = `wamid.e2e.${Date.now()}.${messageCounter++}`;
      const body = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'waba-e2e',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '2348000000000', phone_number_id: 'phone-e2e' },
              contacts: [{ profile: { name: 'E2E Seller' }, wa_id: phone }],
              messages: [{ from: phone, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
            },
          }],
        }],
      };
      const raw = JSON.stringify(body);
      const signature = `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
      return http.post('/api/v1/whatsapp/webhook').set('x-hub-signature-256', signature).set('Content-Type', 'application/json').send(raw);
    }

    it('verifies the Meta challenge', async () => {
      const response = await http.get('/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-e2e&hub.challenge=abc123');
      expect(response.status).toBe(200);
      expect(response.text).toBe('abc123');
    });

    it('links a seller phone with an OTP and records a confirmed sale, then undoes it', async () => {
      account = await register('whatsapp');
      product = await createProduct(account);
      const otpResponse = await http.post('/api/v1/whatsapp/otp').set('Authorization', `Bearer ${account.token}`).send({});
      expect(otpResponse.status).toBe(201);
      const code = otpResponse.body.data.code as string;
      expect(code).toMatch(/^\d{6}$/);
      const linked = await whatsappWebhook(`LINK ${code}`);
      expect(linked.status).toBe(200);
      const contactModel = app.get<Model<Record<string, unknown>>>(getModelToken('WhatsappContact'));
      const contact = await contactModel.findOne({ phone }).lean();
      expect(contact?.verifiedAt).toBeTruthy();
      expect(contact?.businessId).toBe(account.businessId);

      const saleDraft = await whatsappWebhook(`sold 2 ${product.id ? 'E2E Hoodie' : 'hoodie'} 5000, Tola owes 2000`);
      expect(saleDraft.status).toBe(200);
      const contactWithPending = await contactModel.findOne({ phone }).lean();
      expect(contactWithPending?.pendingAction).toBeTruthy();

      const yesResponse = await whatsappWebhook('YES');
      expect(yesResponse.status).toBe(200);
      const sales = await http.get('/api/v1/sales').set('Authorization', `Bearer ${account.token}`);
      expect(sales.body.data.items).toHaveLength(1);
      expect(sales.body.data.items[0].totalKobo).toBe(1000000);
      const afterSale = await http.get(`/api/v1/products/${product.id}`).set('Authorization', `Bearer ${account.token}`);
      expect(afterSale.body.data.quantity).toBe(8);

      const whatsappMessages = app.get<Model<WhatsappMessageDocument>>(getModelToken(WhatsappMessage.name));
      const outbound = await whatsappMessages.find({ businessId: account.businessId, direction: 'outbound' }).lean().exec();
      const bodies = outbound.map((m) => m.body).join('\n---\n');
      expect(bodies).toContain('Receipt:');
      expect(bodies).toContain('Payment page:');

      await whatsappWebhook('EXPENSE 2500 transport');
      const expenses = await http.get('/api/v1/expenses').set('Authorization', `Bearer ${account.token}`);
      expect(expenses.body.data.items.some((e: { amountKobo: number; category: string }) => e.amountKobo === 250000 && e.category === 'transport')).toBe(true);
      const afterExpenseMessages = await whatsappMessages.find({ businessId: account.businessId, direction: 'outbound' }).lean().exec();
      expect(afterExpenseMessages.map((m) => m.body).join('\n')).toContain('Expense recorded');

      await whatsappWebhook('SUMMARY');
      const summaryMessages = await whatsappMessages.find({ businessId: account.businessId, direction: 'outbound' }).lean().exec();
      expect(summaryMessages.map((m) => m.body).join('\n')).toContain('Sales:');

      await whatsappWebhook('UNDO');
      const afterUndo = await http.get('/api/v1/sales').set('Authorization', `Bearer ${account.token}`);
      expect(afterUndo.body.data.items).toHaveLength(0);
      const restored = await http.get(`/api/v1/products/${product.id}`).set('Authorization', `Bearer ${account.token}`);
      expect(restored.body.data.quantity).toBe(10);

      const lowStockProduct = await http.post('/api/v1/products').set('Authorization', `Bearer ${account.token}`).send({
        name: `Low Stock ${run}`, category: 'Tees', priceKobo: 500000, costPriceKobo: 200000, quantity: 1, lowStockThreshold: 2,
      });
      expect(lowStockProduct.status).toBe(201);
      const lowDraft = await whatsappWebhook(`sold 1 Low Stock ${run} 5000`);
      expect(lowDraft.status).toBe(200);
      const lowYes = await whatsappWebhook('YES');
      expect(lowYes.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const lowStockMessages = await whatsappMessages.find({ businessId: account.businessId, templateName: 'ojaly_low_stock' }).lean().exec();
      expect(lowStockMessages).toHaveLength(1);
      expect(lowStockMessages[0].body).toContain('Low stock');
    }, 30000);
  });

  describe('Paystack webhooks', () => {
    let account: (typeof registered)[number];
    let orderId: string;
    let reference: string;
    let paymentId: string;

    beforeAll(async () => {
      account = registered[1];
      const productData = await createProduct(account);
      const productResponse = await http.get(`/api/v1/products/${productData.id}`).set('Authorization', `Bearer ${account.token}`);
      const variantId = productResponse.body.data.variants[0].id;
      const order = await http.post('/api/v1/orders').set('Authorization', `Bearer ${account.token}`).send({
        customerName: 'Webhook Buyer', customerEmail: 'webhook@example.com', customerPhone: '08077770123',
        items: [{ productId: productData.id, variantId, quantity: 1 }],
        dueDate: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(order.status).toBe(201);
      orderId = order.body.data.id;
      reference = `E2E-WEBHOOK-${run}`;
      const paymentModel = app.get<Model<PaymentDocument>>(getModelToken(Payment.name));
      const payment = await paymentModel.create({
        reference, businessId: account.businessId, purpose: 'order', orderId,
        amountKobo: order.body.data.totalKobo, email: 'webhook@example.com', status: 'pending',
      });
      paymentId = payment._id.toString();
    });

    function signedPayload(body: unknown) {
      const raw = JSON.stringify(body);
      const signature = createHmac('sha512', paystackWebhookSecret).update(raw).digest('hex');
      return { raw, signature };
    }

    it('rejects an invalid signature', async () => {
      const { raw } = signedPayload({ event: 'charge.success', data: { id: 1, reference } });
      const response = await http.post('/api/v1/payments/webhook').set('x-paystack-signature', 'bad-signature').set('Content-Type', 'application/json').send(raw);
      expect(response.status).toBe(401);
    });

    it('verifies the signature, marks the order paid and is idempotent', async () => {
      const body = {
        event: 'charge.success',
        data: { id: 771234, status: 'success', reference, amount: 1000000, channel: 'card', paid_at: new Date().toISOString() },
      };
      const { raw, signature } = signedPayload(body);
      const response = await http.post('/api/v1/payments/webhook').set('x-paystack-signature', signature).set('Content-Type', 'application/json').send(raw);
      expect(response.status).toBe(200);
      expect(response.body.data.received).toBe(true);

      const paymentModel = app.get<Model<PaymentDocument>>(getModelToken(Payment.name));
      const orderModel = app.get<Model<OrderDocument>>(getModelToken(Order.name));
      const payment = await paymentModel.findById(paymentId).lean();
      expect(payment?.status).toBe('success');
      const order = await orderModel.findById(orderId).lean();
      expect(order?.status).toBe('paid');
      expect(order?.paymentStatus).toBe('paid');
      expect(order?.amountPaidKobo).toBe(1000000);

      const duplicate = await http.post('/api/v1/payments/webhook').set('x-paystack-signature', signature).set('Content-Type', 'application/json').send(raw);
      expect(duplicate.status).toBe(200);
      expect(duplicate.body.data.duplicate).toBe(true);
      const after = await orderModel.findById(orderId).lean();
      expect(after?.amountPaidKobo).toBe(1000000);
    });
  });
});
