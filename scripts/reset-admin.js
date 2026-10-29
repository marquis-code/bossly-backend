#!/usr/bin/env node
/* Reset or create an Ojaly platform super admin.
 * Usage:
 *   ADMIN_EMAIL=admin@ojaly.org ADMIN_PASSWORD='a-long-unique-password' \
 *   MONGODB_URI='...' pnpm --filter @ojaly/backend admin:reset
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

(async () => {
  const uri = process.env.MONGODB_URI;
  const email = (process.env.ADMIN_EMAIL || process.env.SEED_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || process.env.SEED_SUPER_ADMIN_PASSWORD || '';
  if (!uri) throw new Error('MONGODB_URI is required.');
  if (!email) throw new Error('ADMIN_EMAIL is required.');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.collection('users').updateOne(
    { email },
    {
      $set: { email, passwordHash, name: 'Ojaly Admin', platformRole: 'super_admin', emailVerifiedAt: now, isActive: true, updatedAt: now },
      $setOnInsert: { createdAt: now, phone: null, avatarUrl: null, notificationPrefs: { emailReceipts: true, lowStock: true, weeklySummary: true, debtReminders: true } },
    },
    { upsert: true },
  );
  console.log(result.upsertedCount ? `Created super admin: ${email}` : `Reset password for super admin: ${email}`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
