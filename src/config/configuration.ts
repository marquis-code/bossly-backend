export interface AppConfig {
  env: string;
  port: number;
  appUrl: string;
  adminUrl: string;
  apiUrl: string;
  publicRootDomain: string;
  allowedOrigins: string[];
  mongodbUri: string;
  redisUrl?: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  cloudinary: {
    cloudName?: string;
    apiKey?: string;
    apiSecret?: string;
    folder: string;
  };
  resend: { apiKey?: string; from: string; replyTo?: string };
  paystack: { secretKey?: string; publicKey?: string; webhookSecret?: string };
  whatsapp: {
    phoneNumberId?: string;
    businessAccountId?: string;
    accessToken?: string;
    verifyToken: string;
    appSecret?: string;
    platformNumber?: string;
  };
  llm: { apiKey?: string; baseUrl: string; model: string };
  seed: { email?: string; password?: string };
}

export default (): AppConfig => {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  const defaultAppUrl = isProd ? 'https://ojaly.ng' : 'http://localhost:3100';
  const defaultAdminUrl = isProd ? 'https://admin.ojaly.ng' : 'http://localhost:3101';
  const defaultApiUrl = isProd
    ? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/v1` : 'https://api.ojaly.ng/api/v1')
    : 'http://localhost:4100/api/v1';
  const defaultOrigins = isProd
    ? `${defaultAppUrl},${defaultAdminUrl},https://*.vercel.app,https://*.railway.app,https://*.onrender.com,http://localhost:3100,http://localhost:3101`
    : 'http://localhost:3100,http://localhost:3101';

  return {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4100),
    appUrl: process.env.APP_URL || defaultAppUrl,
    adminUrl: process.env.ADMIN_URL || defaultAdminUrl,
    apiUrl: process.env.API_URL || defaultApiUrl,
    publicRootDomain: process.env.PUBLIC_ROOT_DOMAIN || 'ojaly.ng',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || defaultOrigins)
      .split(',').map((s) => s.trim()).filter(Boolean),
    mongodbUri: (process.env.MONGODB_URI || 'mongodb://localhost:27018/ojaly?directConnection=true') as string,
    redisUrl: process.env.REDIS_URL,
    jwt: {
      accessSecret: (process.env.JWT_ACCESS_SECRET || 'ojaly-default-access-secret-0123456789abcdef') as string,
      refreshSecret: (process.env.JWT_REFRESH_SECRET || 'ojaly-default-refresh-secret-fedcba9876543210') as string,
      accessTtl: process.env.JWT_ACCESS_TTL || '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
    },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_FOLDER || 'ojaly',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.MAIL_FROM || 'Ojaly <hello@ojaly.ng>',
    replyTo: process.env.MAIL_REPLY_TO || 'hello@ojaly.ng',
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
  },
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'ojaly-webhook-verify',
    appSecret: process.env.WHATSAPP_APP_SECRET,
    platformNumber: process.env.WHATSAPP_PLATFORM_NUMBER,
  },
  llm: {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  },
  seed: {
    email: process.env.SEED_SUPER_ADMIN_EMAIL,
    password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  },
  };
};
