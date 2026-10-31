import fs from 'node:fs';
import mongoose from 'mongoose';

const API = 'https://api.ojaly.org/api/v1';
const PASSWORD = 'DemoPass123!';
const ACCOUNTS = [
  {
    key: 'tola', name: 'Tola Adeyemi', email: 'demo.tola@ojaly.org', businessName: 'Tola Thrift',
    category: 'fashion', businessMode: 'products', address: 'Yaba, Lagos', phone: '08055550101',
    tagline: 'Vintage finds, thrifted with love.', templateKey: 'lagos-pop',
    hero: 'https://ojaly.org/images/business/market-trader.webp',
    products: [
      ['Vintage Denim Jacket', 'Thrifted denim with a soft, worn-in finish.', 'Jackets', 1250000, 600000, 8, 'market-trader'],
      ['Ankara Tote Bag', 'Handmade tote in bold Ankara print.', 'Bags', 850000, 400000, 15, 'baker'],
      ['Oversized Campus Tee', 'Heavyweight cotton tee in cream.', 'Tops', 700000, 300000, 20, 'food-founder'],
    ],
  },
  {
    key: 'tech', name: 'Tunde Bello', email: 'demo.tech@ojaly.org', businessName: 'Campus Tech',
    category: 'gadgets', businessMode: 'products', address: 'Akoka, Lagos', phone: '08055550102',
    tagline: 'Everyday tech that actually works.', templateKey: 'market-bright',
    hero: 'https://ojaly.org/images/business/website-founder.webp',
    products: [
      ['Wireless Earbuds', 'Clear calls, pocket-sized case and 24-hour battery.', 'Audio', 1800000, 900000, 10, 'website-founder'],
      ['20,000mAh Power Bank', 'Fast charging for long campus days.', 'Power', 2500000, 1500000, 6, 'barber'],
      ['Adjustable Phone Stand', 'Sturdy aluminium stand for desk and bed.', 'Accessories', 450000, 150000, 30, 'market-trader'],
    ],
  },
  {
    key: 'glow', name: 'Ada Nwosu', email: 'demo.glow@ojaly.org', businessName: 'The Glow Room',
    category: 'hair', businessMode: 'services', address: 'Yaba, Lagos', phone: '08055550103',
    tagline: 'Braids, nails and soft-girl maintenance.', templateKey: 'lagos-pop',
    hero: 'https://ojaly.org/images/business/barber.webp',
    services: [
      ['Knotless Braids', 'Medium knotless braids, hair included. 2–3 hours.', 'Hair', 2500000, 150, 500000],
      ['Gel Manicure', 'Shape, cuticle care and long-wear gel colour.', 'Nails', 800000, 60, 200000],
      ['Wig Installation', 'Melted frontal install with styling.', 'Hair', 3500000, 120, 700000],
    ],
  },
  {
    key: 'kola', name: 'Kola Adeyemi', email: 'demo.kola@ojaly.org', businessName: 'Kola Cuts',
    category: 'barbering', businessMode: 'services', address: 'Surulere, Lagos', phone: '08055550104',
    tagline: 'Sharp fades, clean lines, no waiting.', templateKey: 'market-bright',
    hero: 'https://ojaly.org/images/business/barber.webp',
    services: [
      ['Signature Fade', 'Consultation, fade and finish.', 'Barbering', 400000, 45, 0],
      ['Beard Sculpt', 'Shape, line-up and hot towel finish.', 'Barbering', 250000, 30, 0],
      ['Kids Cut', 'Patient, clean cut for the little ones.', 'Barbering', 350000, 30, 0],
    ],
  },
];

async function request(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${path} -> ${res.status}: ${json?.error?.message || 'error'}`);
  return json.data;
}

async function loginOrRegister(account) {
  try {
    return await request('POST', '/auth/register', null, {
      name: account.name, email: account.email, password: PASSWORD,
      businessName: account.businessName, category: account.category,
      businessMode: account.businessMode, address: account.address, phone: account.phone,
    });
  } catch (error) {
    if (!String(error.message).includes('already exists')) throw error;
    return await request('POST', '/auth/login', null, { email: account.email, password: PASSWORD });
  }
}

async function seedProduct(account) {
  const session = await loginOrRegister(account);
  const token = session.accessToken;
  await request('PATCH', '/builder', token, {
    tagline: account.tagline, templateKey: account.templateKey,
    bannerUrl: account.hero, logoUrl: `https://ojaly.org/images/business/${account.products[0][6]}.webp`,
    about: `${account.businessName} is a seeded Ojaly demo store for testing the complete product experience.`,
    address: account.address, brandColor: '#FF5A1F', sections: ['hero', 'featured', 'products', 'contact'],
  }).catch((error) => console.log('product branding skipped', account.key, error.message));
  let existing = (await request('GET', '/products', token)).items || [];
  for (const [name, description, category, priceKobo, costPriceKobo, quantity, image] of account.products) {
    let product = existing.find((item) => item.name === name);
    if (!product) product = await request('POST', '/products', token, {
      name, description, category, priceKobo, costPriceKobo, quantity,
      lowStockThreshold: 3, images: [`https://ojaly.org/images/business/${image}.webp`],
    });
  }
  try { await request('POST', '/builder/publish', token); } catch (error) { console.log('product publish skipped', account.key, error.message); }
  const products = (await request('GET', '/products', token)).items || [];
  for (let i = 0; i < Math.min(2, products.length); i++) {
    try {
      await request('POST', '/sales', token, {
        customerName: i === 0 ? 'Demo Product Buyer' : 'Campus Customer',
        customerPhone: `08055550${200 + i}`,
        items: [{ productId: products[i].id, quantity: 1 }],
        amountPaidKobo: products[i].priceKobo, paymentMethod: 'cash',
      });
    } catch (error) { console.log('sale skipped', account.key, error.message); }
  }
  return { account, businessId: session.activeBusinessId, businessName: account.businessName, email: account.email };
}

async function seedService(account) {
  const session = await loginOrRegister(account);
  const token = session.accessToken;
  await request('PATCH', '/businesses/current', token, { bookingSettings: { enabled: true, autoConfirm: true, depositPercent: 20, leadTimeMinutes: 0, windowDays: 60 } });
  let existing = await request('GET', '/services', token);
  for (const [name, description, category, priceKobo, durationMinutes, depositKobo] of account.services) {
    let service = existing.find((item) => item.name === name);
    if (!service) service = await request('POST', '/services', token, {
      name, description, category, priceKobo, durationMinutes, depositKobo,
      requiresDeposit: depositKobo > 0, isActive: true, isPublic: true,
      imageUrl: `https://ojaly.org/images/business/${account.hero.split('/').pop()}`,
    });
  }
  await request('PATCH', '/builder', token, {
    tagline: account.tagline, templateKey: account.templateKey,
    bannerUrl: account.hero, logoUrl: `https://ojaly.org/images/business/${account.hero.split('/').pop()}`,
    about: `${account.businessName} is a seeded Ojaly demo service business for testing bookings and payments.`,
    address: account.address, brandColor: '#FF5A1F', sections: ['hero', 'featured', 'products', 'contact'],
  }).catch((error) => console.log('service branding skipped', account.key, error.message));
  try { await request('POST', '/builder/publish', token); } catch (error) { console.log('service publish skipped', account.key, error.message); }
  const services = await request('GET', '/services', token);
  let created = 0;
  for (let s = 0; s < services.length && created < 2; s++) {
    const service = services[s];
    for (let d = 1; d < 16 && created < 2; d++) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      let availability;
      try { availability = await request('GET', `/bookings/availability?serviceId=${service.id}&date=${date}`, token); } catch { continue; }
      const slot = availability.slots?.[0];
      if (!slot) continue;
      let booking;
      try {
        booking = await request('POST', '/bookings', token, {
          serviceId: service.id, startAt: slot.startAt,
          customerName: created === 0 ? 'Demo Appointment Customer' : 'Demo Pending Customer',
          customerPhone: `08055551${300 + created}`,
          customerEmail: `demo.customer${created}@ojaly.org`,
          notes: 'Seeded demo booking',
        });
      } catch (error) { console.log('booking skipped', account.key, error.message); continue; }
      if (created === 0) {
        try { await request('PATCH', `/bookings/${booking.id}/status`, token, { status: 'completed' }); } catch (error) { console.log('complete skipped', account.key, error.message); }
      }
      created++;
    }
  }
  return { account, businessId: session.activeBusinessId, businessName: account.businessName, email: account.email, bookings: created };
}

const results = [];
for (const account of ACCOUNTS.filter((item) => item.businessMode === 'products')) results.push(await seedProduct(account));
for (const account of ACCOUNTS.filter((item) => item.businessMode === 'services')) results.push(await seedService(account));

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;
for (const result of results) {
  await db.collection('businesses').updateOne(
    { _id: new mongoose.Types.ObjectId(result.businessId) },
    { $set: { isDemo: true, campusVerified: true, campusVerifiedAt: new Date(), verificationRequestedAt: null, storefrontPublished: true, campusCode: null, campusName: 'Lagos', marketplaceFeePercent: 5 } },
  );
}
await mongoose.disconnect();
console.log(JSON.stringify(results.map((r) => ({ business: r.businessName, email: r.email, password: PASSWORD, businessId: r.businessId, bookings: r.bookings })), null, 2));
