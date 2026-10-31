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
  sms: { provider: string; apiKey?: string; senderId?: string; baseUrl: string };
  calendar: {
    googleClientId?: string;
    googleClientSecret?: string;
    googleRedirectUri?: string;
    outlookClientId?: string;
    outlookClientSecret?: string;
    outlookRedirectUri?: string;
    tokenSecret: string;
  };
  whatsapp: {
    provider?: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    accessToken?: string;
    verifyToken: string;
    appSecret?: string;
    platformNumber?: string;
    d360ApiKey?: string;
    d360BaseUrl?: string;
    evolutionApiUrl?: string;
    evolutionApiKey?: string;
    evolutionInstance?: string;
  };
  llm: { apiKey?: string; baseUrl: string; model: string; geminiApiKey?: string; geminiModel?: string };
  seed: { email?: string; password?: string };
}

export default (): AppConfig => {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  const defaultAppUrl = isProd ? 'https://ojaly.org' : 'http://localhost:3100';
  const defaultAdminUrl = isProd ? 'https://admin.ojaly.org' : 'http://localhost:3101';
  const defaultApiUrl = isProd
    ? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/v1` : 'https://api.ojaly.org/api/v1')
    : 'http://localhost:4100/api/v1';
  const defaultOrigins = isProd
    ? `${defaultAppUrl},${defaultAdminUrl},https://*.vercel.app,https://*.railway.app,https://*.onrender.com,http://localhost:3100,http://localhost:3101`
    : 'http://localhost:3100,http://localhost:3101';

  const cleanSender = (val?: string, fallback = 'Ojaly <hello@ojaly.org>') => {
    let str = (val || fallback).trim();
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1).trim();
    }
    return str.replace(/@ojaly\.ng/gi, '@ojaly.org').replace(/@bossly\.[a-z]+/gi, '@ojaly.org') || fallback;
  };

  const cleanReplyTo = (val?: string, fallback = 'hello@ojaly.org') => {
    let str = (val || fallback).trim();
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      str = str.slice(1, -1).trim();
    }
    return str.replace(/@ojaly\.ng/gi, '@ojaly.org').replace(/@bossly\.[a-z]+/gi, '@ojaly.org') || fallback;
  };

  return {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4100),
    appUrl: (process.env.APP_URL || defaultAppUrl).replace(/ojaly\.ng/g, 'ojaly.org'),
    adminUrl: (process.env.ADMIN_URL || defaultAdminUrl).replace(/ojaly\.ng/g, 'ojaly.org'),
    apiUrl: (process.env.API_URL || defaultApiUrl).replace(/ojaly\.ng/g, 'ojaly.org'),
    publicRootDomain: (process.env.PUBLIC_ROOT_DOMAIN || 'ojaly.org').replace(/ojaly\.ng/g, 'ojaly.org'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || defaultOrigins)
      .replace(/ojaly\.ng/g, 'ojaly.org')
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
    from: cleanSender(process.env.MAIL_FROM),
    replyTo: cleanReplyTo(process.env.MAIL_REPLY_TO),
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
  },
  calendar: {
    googleClientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI,
    outlookClientId: process.env.OUTLOOK_CALENDAR_CLIENT_ID,
    outlookClientSecret: process.env.OUTLOOK_CALENDAR_CLIENT_SECRET,
    outlookRedirectUri: process.env.OUTLOOK_CALENDAR_REDIRECT_URI,
    tokenSecret: process.env.CALENDAR_TOKEN_SECRET || process.env.JWT_ACCESS_SECRET || 'ojaly-calendar-token-secret',
  },
  sms: {
    provider: process.env.SMS_PROVIDER || 'termii',
    apiKey: process.env.TERMII_API_KEY || '',
    senderId: process.env.TERMII_SENDER_ID || '',
    baseUrl: (process.env.TERMII_BASE_URL || 'https://api.ng.termii.com').replace(/\/$/, ''),
  },
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'ojaly-webhook-verify',
    appSecret: process.env.WHATSAPP_APP_SECRET,
    platformNumber: process.env.WHATSAPP_PLATFORM_NUMBER,
    provider: process.env.WHATSAPP_PROVIDER || 'cloud',
    d360ApiKey: process.env.WHATSAPP_360DIALOG_API_KEY,
    d360BaseUrl: (process.env.WHATSAPP_360DIALOG_BASE_URL || 'https://waba-v2.360dialog.io').replace(/\/$/, ''),
    evolutionApiUrl: (process.env.WHATSAPP_EVOLUTION_API_URL || '').replace(/\/$/, ''),
    evolutionApiKey: process.env.WHATSAPP_EVOLUTION_API_KEY,
    evolutionInstance: process.env.WHATSAPP_EVOLUTION_INSTANCE || 'ojaly',
  },
  llm: {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },
  seed: {
    email: process.env.SEED_SUPER_ADMIN_EMAIL,
    password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  },
  };
};
