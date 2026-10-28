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
import { Referral, ReferralDocument } from '../src/modules/affiliates/referral.schema';
import { User, UserDocument } from '../src/modules/users/user.schema';
import { AffiliatesService } from '../src/modules/affiliates/affiliates.service';

describe('Affiliates, admin tooling and impersonation (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryReplSet;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  const paystackSecret = 'whsec_features_e2e';
  let referrer: { token: string; businessId: string; email: string };
  let referred: { token: string; businessId: string; email: string; userId: string };
  let adminToken: string;
  let referralCode: string;
  let payoutId: string;

  beforeAll(async () => {
    process.env.MONGOMS_DOWNLOAD_DIR = resolve(__dirname, '../.cache/mongodb-binaries');
    const cachedDir = resolve(__dirname, '../../../node_modules/.cache/mongodb-memory-server');
    if (existsSync(cachedDir)) {
      const binary = readdirSync(cachedDir).find((file) => file.startsWith('mongod'));
      if (binary) process.env.MONGOMS_SYSTEM_BINARY = join(cachedDir, binary);
    }
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: mongod.getUri('ojaly-features-e2e'),
      JWT_ACCESS_SECRET: 'test-features-access-secret-0123456789012345',
      JWT_REFRESH_SECRET: 'test-features-refresh-secret-012345678901234',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      APP_URL: 'http://localhost:3100',
      API_URL: 'http://localhost:4100/api/v1',
      PUBLIC_ROOT_DOMAIN: 'ojaly.org',
      ALLOWED_ORIGINS: 'http://localhost:3100',
      PAYSTACK_SECRET_KEY: 'sk_test_features',
      PAYSTACK_WEBHOOK_SECRET: paystackSecret,
      WHATSAPP_VERIFY_TOKEN: 'verify-features',
      WHATSAPP_APP_SECRET: 'whatsapp-features',
      RESEND_API_KEY: '',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    http = request(app.getHttpServer());
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  }, 60000);

  async function register(name: string, extra: Record<string, unknown> = {}) {
    const email = `features-${run}-${name}@example.com`;
    const response = await http.post('/api/v1/auth/register').send({
      name: `Features ${name}`, email, password: 'Testing123',
      businessName: `Features ${name} ${run}`, category: 'fashion', phone: '08031234567', ...extra,
    });
    expect(response.status).toBe(201);
    return { token: response.body.data.accessToken as string, businessId: response.body.data.activeBusinessId as string, email, userId: response.body.data.user.id as string };
  }

  it('creates an affiliate link and attributes a referred signup', async () => {
    referrer = await register('referrer');
    const overview = await http.get('/api/v1/affiliates/me').set('Authorization', `Bearer ${referrer.token}`);
    expect(overview.status).toBe(200);
    referralCode = overview.body.data.code;
    expect(referralCode).toMatch(/^BOS/);
    expect(overview.body.data.link).toContain(`ref=${referralCode}`);

    referred = await register('referred', { referral: referralCode });
    const after = await http.get('/api/v1/affiliates/me').set('Authorization', `Bearer ${referrer.token}`);
    expect(after.body.data.stats.referralCount).toBe(1);
    expect(after.body.data.referrals[0].status).toBe('registered');
  });

  it('awards a 20% commission on the referred business’s first subscription payment', async () => {
    const paymentModel = app.get<Model<PaymentDocument>>(getModelToken(Payment.name));
    const reference = `FEAT-SUB-${run}`;
    await paymentModel.create({
      reference, businessId: referred.businessId, purpose: 'subscription', amountKobo: 600000,
      email: referred.email, status: 'pending', metadata: { planKey: 'boss', interval: 'monthly', couponCode: null },
    });
    const body = { event: 'charge.success', data: { id: 881122, status: 'success', reference, amount: 600000, channel: 'card', paid_at: new Date().toISOString() } };
    const raw = JSON.stringify(body);
    const signature = createHmac('sha512', paystackSecret).update(raw).digest('hex');
    const webhook = await http.post('/api/v1/payments/webhook').set('x-paystack-signature', signature).set('Content-Type', 'application/json').send(raw);
    expect(webhook.status).toBe(200);

    const referralModel = app.get<Model<ReferralDocument>>(getModelToken(Referral.name));
    const referral = await referralModel.findOne({ referredBusinessId: referred.businessId }).lean();
    expect(referral?.status).toBe('converted');
    expect(referral?.commissionKobo).toBe(120000);
    expect(referral?.commissionStatus).toBe('pending');

    await referralModel.updateOne({ referredBusinessId: referred.businessId }, { $set: { commissionAvailableAt: new Date(Date.now() - 1000) } });
    await app.get(AffiliatesService).releaseCommissions();
    const overview = await http.get('/api/v1/affiliates/me').set('Authorization', `Bearer ${referrer.token}`);
    expect(overview.body.data.stats.availableKobo).toBe(120000);
    expect(overview.body.data.stats.pendingKobo).toBe(0);
  });

  it('requests a payout and lets a super admin mark it paid', async () => {
    const requestPayout = await http.post('/api/v1/affiliates/payouts').set('Authorization', `Bearer ${referrer.token}`).send({
      amountKobo: 120000, bankName: 'GTBank', accountName: 'Features Referrer', accountNumber: '0123456789',
    });
    expect(requestPayout.status).toBe(201);
    payoutId = requestPayout.body.data.payout.id;
    const afterRequest = await http.get('/api/v1/affiliates/me').set('Authorization', `Bearer ${referrer.token}`);
    expect(afterRequest.body.data.stats.availableKobo).toBe(0);
    expect(afterRequest.body.data.stats.payoutPendingKobo).toBe(120000);

    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    await userModel.updateOne({ _id: referred.userId }, { $set: { platformRole: 'super_admin' } });
    const adminLogin = await http.post('/api/v1/auth/platform/login').send({ email: referred.email, password: 'Testing123' });
    expect(adminLogin.status).toBe(201);
    adminToken = adminLogin.body.data.accessToken;

    const list = await http.get('/api/v1/admin/affiliate-payouts?status=requested').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    const paid = await http.patch(`/api/v1/admin/affiliate-payouts/${payoutId}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'paid', reference: 'GTB-E2E-1', note: 'Test transfer' });
    expect(paid.status).toBe(200);
    const final = await http.get('/api/v1/affiliates/me').set('Authorization', `Bearer ${referrer.token}`);
    expect(final.body.data.stats.paidKobo).toBe(120000);
    expect(final.body.data.stats.payoutPendingKobo).toBe(0);
  });

  it('supports admin notes and CSV exports', async () => {
    const note = await http.post('/api/v1/admin/notes').set('Authorization', `Bearer ${adminToken}`).send({
      targetType: 'business', targetId: referred.businessId, body: 'Owner called about a payout. Confirmed bank name.', pinned: true,
    });
    expect(note.status).toBe(201);
    expect(note.body.data.pinned).toBe(true);
    const notes = await http.get(`/api/v1/admin/notes?targetType=business&targetId=${referred.businessId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(notes.status).toBe(200);
    expect(notes.body.data).toHaveLength(1);
    const updated = await http.patch(`/api/v1/admin/notes/${note.body.data.id}`).set('Authorization', `Bearer ${adminToken}`).send({ body: 'Updated note', pinned: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.body).toBe('Updated note');

    const csv = await http.get('/api/v1/admin/exports/users').set('Authorization', `Bearer ${adminToken}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('email');
    expect(csv.text).toContain(referrer.email);
    const deleted = await http.delete(`/api/v1/admin/notes/${note.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
  });

  it('issues a short-lived impersonation token that can act as the business owner', async () => {
    const impersonate = await http.post(`/api/v1/admin/businesses/${referrer.businessId}/impersonate`).set('Authorization', `Bearer ${adminToken}`);
    expect(impersonate.status).toBe(201);
    expect(impersonate.body.data.token).toBeTruthy();
    const token = impersonate.body.data.token;
    const me = await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.activeBusinessId).toBe(referrer.businessId);
    const products = await http.get('/api/v1/products').set('Authorization', `Bearer ${token}`);
    expect(products.status).toBe(200);
    const updated = await http.patch('/api/v1/businesses/current').set('Authorization', `Bearer ${token}`).send({ tagline: 'Impersonated support check' });
    expect(updated.status).toBe(200);
    const audits = await http.get('/api/v1/admin/audit-logs?action=admin.impersonation_started').set('Authorization', `Bearer ${adminToken}`);
    expect(audits.body.data.items.length).toBeGreaterThanOrEqual(1);
    const actionAudits = await http.get(`/api/v1/admin/audit-logs?action=business.updated&businessId=${referrer.businessId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(actionAudits.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(actionAudits.body.data.items[0].metadata.impersonatedBy).toBe(referred.userId);
  });
});
