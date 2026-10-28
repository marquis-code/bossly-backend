import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Service menu and bookings (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryReplSet;
  let http: ReturnType<typeof request>;
  let token = '';
  let businessId = '';
  let slug = '';
  let serviceId = '';
  let providerId = '';
  const run = randomUUID().slice(0, 8);
  const base = () => ({ Authorization: `Bearer ${token}`, 'x-business-id': businessId });

  beforeAll(async () => {
    process.env.MONGOMS_DOWNLOAD_DIR = resolve(__dirname, '../.cache/mongodb-binaries');
    const cachedDir = resolve(__dirname, '../../../node_modules/.cache/mongodb-memory-server');
    if (existsSync(cachedDir)) {
      const binary = readdirSync(cachedDir).find((file) => file.startsWith('mongod'));
      if (binary) process.env.MONGOMS_SYSTEM_BINARY = join(cachedDir, binary);
    }
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    Object.assign(process.env, {
      NODE_ENV: 'test', MONGODB_URI: mongod.getUri('ojaly-services-e2e'),
      JWT_ACCESS_SECRET: 'test-services-access-secret-0123456789012345',
      JWT_REFRESH_SECRET: 'test-services-refresh-secret-012345678901234',
      JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '30d',
      APP_URL: 'http://localhost:3100', API_URL: 'http://localhost:4100/api/v1',
      PUBLIC_ROOT_DOMAIN: 'ojaly.org', ALLOWED_ORIGINS: 'http://localhost:3100',
      PAYSTACK_SECRET_KEY: 'sk_test_services', PAYSTACK_WEBHOOK_SECRET: 'whsec_services',
      WHATSAPP_VERIFY_TOKEN: 'verify-services', WHATSAPP_APP_SECRET: 'whatsapp-services', RESEND_API_KEY: '',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    http = request(app.getHttpServer());

    const registered = await http.post('/api/v1/auth/register').send({
      name: 'Service Owner', email: `services-${run}@ojaly.org`, password: 'Testing123',
      businessName: `Glow Test ${run}`, category: 'beauty', phone: '08031234567',
    });
    expect(registered.status).toBe(201);
    token = registered.body.data.accessToken;
    businessId = registered.body.data.activeBusinessId;
    const current = await http.get('/api/v1/businesses/current').set(base());
    slug = current.body.data.business.slug;

    const settings = await http.patch('/api/v1/businesses/current').set(base()).send({
      businessMode: 'services',
      bookingSettings: {
        enabled: true, autoConfirm: true, leadTimeMinutes: 0, windowDays: 60,
        slotIntervalMinutes: 30, cancellationWindowHours: 24, depositPercent: 0,
        reminderHoursBefore: 24, policy: 'Come as you are.',
        weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, isOpen: true, start: '09:00', end: '18:00' })),
        closedDates: [],
      },
    });
    expect(settings.status).toBe(200);
  }, 120000);

  afterAll(async () => { await app?.close(); await mongod?.stop(); }, 60000);

  it('creates a team member and a bookable service', async () => {
    const provider = await http.post('/api/v1/providers').set(base()).send({
      name: 'Amaka Obi', title: 'Braider', color: '#FF5A1F', isBookable: true,
    });
    expect(provider.status).toBe(201);
    providerId = provider.body.data.id;
    const service = await http.post('/api/v1/services').set(base()).send({
      name: 'Knotless Braids', category: 'Hair', description: 'Scalp-first braids.',
      durationMinutes: 60, priceKobo: 1500000, depositKobo: 0,
      requiresDeposit: false, providerIds: [providerId],
    });
    expect(service.status).toBe(201);
    serviceId = service.body.data.id;
    expect(service.body.data.providerIds).toContain(providerId);
    const published = await http.post('/api/v1/builder/publish').set(base()).send({});
    expect([200, 201]).toContain(published.status);
  });

  it('shows the service on the public storefront and open slots', async () => {
    const menu = await http.get(`/api/v1/storefront/${slug}/services`);
    expect(menu.status).toBe(200);
    expect(menu.body.data.items.some((s: { id: string }) => s.id === serviceId)).toBe(true);
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() + 86400000));
    const availability = await http.get(`/api/v1/storefront/${slug}/availability?serviceId=${serviceId}&date=${tomorrow}`);
    expect(availability.status).toBe(200);
    expect(availability.body.data.slots.length).toBeGreaterThan(0);
  });

  it('lets a customer book, then manage and cancel from the public page', async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() + 2 * 86400000));
    const availability = await http.get(`/api/v1/storefront/${slug}/availability?serviceId=${serviceId}&date=${date}`);
    const slot = availability.body.data.slots[0];
    expect(slot).toBeTruthy();
    const created = await http.post(`/api/v1/storefront/${slug}/bookings`).send({
      serviceId, providerId, startAt: slot.startAt, customerName: 'Ada Nwosu',
      customerPhone: '08055551234', customerEmail: `ada-${run}@ojaly.org`, notes: 'Small parts',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.booking.status).toBe('confirmed');
    const tokenValue = created.body.data.booking.publicToken;
    const refundGuard = await http.post(`/api/v1/bookings/${created.body.data.booking.id}/refund`).set(base()).send({});
    expect(refundGuard.status).toBe(400);
    const lookup = await http.get(`/api/v1/public/bookings/${tokenValue}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.booking.bookingNumber).toContain('BKG');
    const calendar = await http.get(`/api/v1/public/bookings/${tokenValue}/calendar.ics`);
    expect(calendar.status).toBe(200);
    expect(calendar.text).toContain('BEGIN:VCALENDAR');
    expect(calendar.text).toContain('SUMMARY:');
    const cancelled = await http.post(`/api/v1/public/bookings/${tokenValue}/cancel`).send({ reason: 'Plans changed' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.data.cancelled).toBe(true);
  });

  it('returns a private business calendar feed', async () => {
    const feed = await http.get('/api/v1/bookings/calendar-feed').set(base());
    expect(feed.status).toBe(200);
    expect(feed.body.data.url).toContain('/public/bookings/calendar/');
    const token = String(feed.body.data.url).split('/').pop();
    const calendar = await http.get(`/api/v1/public/bookings/calendar/${token}`);
    expect(calendar.status).toBe(200);
    expect(calendar.text).toContain('BEGIN:VCALENDAR');
  });

  it('creates a prepaid package and exposes it publicly', async () => {
    const created = await http.post('/api/v1/packages').set(base()).send({
      name: '3 Gel Manicures', serviceId, sessions: 3, priceKobo: 2000000, validityDays: 60,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.sessions).toBe(3);
    const publicList = await http.get(`/api/v1/storefront/${slug}/packages`);
    expect(publicList.status).toBe(200);
    expect(publicList.body.data.items.some((item: { id: string }) => item.id === created.body.data.id)).toBe(true);
  });

  it('captures a waitlist request and notifies it', async () => {
    const from = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() + 10 * 86400000));
    const to = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() + 17 * 86400000));
    const joined = await http.post(`/api/v1/storefront/${slug}/waitlist`).send({
      serviceId, providerId, customerName: 'Waitlist Client', customerPhone: '08055558888',
      customerEmail: `waitlist-${run}@ojaly.org`, preferredFrom: from, preferredTo: to,
    });
    expect(joined.status).toBe(201);
    expect(joined.body.data.entry.status).toBe('waiting');
    const list = await http.get('/api/v1/waitlist').set(base());
    expect(list.status).toBe(200);
    expect(list.body.data.some((e: { customerName: string }) => e.customerName === 'Waitlist Client')).toBe(true);
    const entry = list.body.data.find((e: { customerName: string }) => e.customerName === 'Waitlist Client');
    const notified = await http.post(`/api/v1/waitlist/${entry.id}/notify`).set(base());
    expect(notified.status).toBe(201);
    expect(notified.body.data.status).toBe('notified');
  });

  it('creates a weekly recurring series', async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() + 5 * 86400000));
    const availability = await http.get(`/api/v1/storefront/${slug}/availability?serviceId=${serviceId}&date=${date}`);
    const slot = availability.body.data.slots[0];
    expect(slot).toBeTruthy();
    const created = await http.post('/api/v1/bookings/recurring').set(base()).send({
      serviceId, providerId, startAt: slot.startAt, customerName: 'Repeat Client',
      customerPhone: '08055550123', customerEmail: `repeat-${run}@ojaly.org`,
      frequency: 'weekly', occurrences: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.bookings).toHaveLength(3);
    expect(created.body.data.seriesId).toBeTruthy();
    expect(created.body.data.bookings[1].seriesIndex).toBe(1);
    expect(created.body.data.bookings[2].seriesTotal).toBe(3);
  });

  it('completes an appointment into a sale and receipt', async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() + 3 * 86400000));
    const availability = await http.get(`/api/v1/storefront/${slug}/availability?serviceId=${serviceId}&date=${date}`);
    const slot = availability.body.data.slots[0];
    const created = await http.post(`/api/v1/storefront/${slug}/bookings`).send({
      serviceId, providerId, startAt: slot.startAt, customerName: 'Bisi Ajayi',
      customerPhone: '08055559876', customerEmail: `bisi-${run}@ojaly.org`,
    });
    const id = created.body.data.booking.id;
    const completed = await http.patch(`/api/v1/bookings/${id}/status`).set(base()).send({ status: 'completed' });
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('completed');
    expect(completed.body.data.saleId).toBeTruthy();
    expect(completed.body.data.reviewToken).toBeTruthy();
    const reviewContext = await http.get(`/api/v1/public/reviews/${completed.body.data.reviewToken}`);
    expect(reviewContext.status).toBe(200);
    expect(reviewContext.body.data.canReview).toBe(true);
    const review = await http.post(`/api/v1/public/reviews/${completed.body.data.reviewToken}`).send({ rating: 5, comment: 'Beautiful work and right on time.' });
    expect(review.status).toBe(201);
    expect(review.body.data.rating).toBe(5);
    const reviewList = await http.get('/api/v1/reviews').set(base());
    expect(reviewList.status).toBe(200);
    expect(reviewList.body.data.items.some((r: { bookingId: string }) => r.bookingId === id)).toBe(true);
  });
});
