import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4100),
  APP_URL: Joi.string().uri().default('https://ojaly.ng'),
  ADMIN_URL: Joi.string().uri().default('https://admin.ojaly.ng'),
  API_URL: Joi.string().uri().default('https://api.ojaly.ng/api/v1'),
  PUBLIC_ROOT_DOMAIN: Joi.string().hostname().default('ojaly.ng'),
  ALLOWED_ORIGINS: Joi.string().default('https://ojaly.ng,https://admin.ojaly.ng,https://*.vercel.app,https://*.railway.app,https://*.onrender.com,http://localhost:3100,http://localhost:3101'),
  MONGODB_URI: Joi.string().default('mongodb://localhost:27018/ojaly?directConnection=true'),
  REDIS_URL: Joi.string().uri().optional().allow(''),
  JWT_ACCESS_SECRET: Joi.string().min(16).default('ojaly-default-access-secret-0123456789abcdef'),
  JWT_REFRESH_SECRET: Joi.string().min(16).default('ojaly-default-refresh-secret-fedcba9876543210'),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('30d'),
  CLOUDINARY_CLOUD_NAME: Joi.string().optional().allow(''),
  CLOUDINARY_API_KEY: Joi.string().optional().allow(''),
  CLOUDINARY_API_SECRET: Joi.string().optional().allow(''),
  CLOUDINARY_FOLDER: Joi.string().default('ojaly'),
  RESEND_API_KEY: Joi.string().optional().allow(''),
  MAIL_FROM: Joi.string().default('Ojaly <hello@ojaly.ng>'),
  MAIL_REPLY_TO: Joi.string().optional().allow('').default('hello@ojaly.ng'),
  PAYSTACK_SECRET_KEY: Joi.string().optional().allow(''),
  PAYSTACK_PUBLIC_KEY: Joi.string().optional().allow(''),
  PAYSTACK_WEBHOOK_SECRET: Joi.string().optional().allow(''),
  WHATSAPP_PHONE_NUMBER_ID: Joi.string().optional().allow(''),
  WHATSAPP_BUSINESS_ACCOUNT_ID: Joi.string().optional().allow(''),
  WHATSAPP_ACCESS_TOKEN: Joi.string().optional().allow(''),
  WHATSAPP_VERIFY_TOKEN: Joi.string().default('ojaly-webhook-verify'),
  WHATSAPP_APP_SECRET: Joi.string().optional().allow(''),
  WHATSAPP_PLATFORM_NUMBER: Joi.string().optional().allow(''),
  LLM_API_KEY: Joi.string().optional().allow(''),
  LLM_BASE_URL: Joi.string().uri().default('https://api.openai.com/v1'),
  LLM_MODEL: Joi.string().default('gpt-4o-mini'),
  SEED_SUPER_ADMIN_EMAIL: Joi.string().email().optional().allow(''),
  SEED_SUPER_ADMIN_PASSWORD: Joi.string().min(8).optional().allow(''),
}).unknown(true);

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const { error, value } = envSchema.validate(config, { abortEarly: false, allowUnknown: true });
  if (error) {
    console.warn(`[Ojaly Warning] Environment schema validation notices: ${error.message}`);
  }
  const env = (value || config) as Record<string, any>;
  
  if (env.NODE_ENV === 'production') {
    const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;
    const renderUrl = env.RENDER_EXTERNAL_URL || process.env.RENDER_EXTERNAL_URL;

    // Auto-upgrade API_URL to https or platform domain
    if (!env.API_URL || env.API_URL.includes('localhost') || !String(env.API_URL).startsWith('https://')) {
      if (railwayDomain) {
        env.API_URL = `https://${railwayDomain}/api/v1`;
      } else if (renderUrl) {
        env.API_URL = `${renderUrl}/api/v1`;
      } else if (env.API_URL && String(env.API_URL).startsWith('http://')) {
        env.API_URL = String(env.API_URL).replace(/^http:\/\//, 'https://');
      } else {
        env.API_URL = 'https://api.ojaly.ng/api/v1';
      }
    }

    // Auto-upgrade APP_URL to https
    if (!env.APP_URL || env.APP_URL.includes('localhost') || !String(env.APP_URL).startsWith('https://')) {
      env.APP_URL = 'https://ojaly.ng';
    }

    // Auto-upgrade ADMIN_URL to https
    if (!env.ADMIN_URL || env.ADMIN_URL.includes('localhost') || !String(env.ADMIN_URL).startsWith('https://')) {
      env.ADMIN_URL = 'https://admin.ojaly.ng';
    }

    // Auto-populate ALLOWED_ORIGINS with https origins
    if (!env.ALLOWED_ORIGINS || !String(env.ALLOWED_ORIGINS).includes('https://')) {
      env.ALLOWED_ORIGINS = `${env.APP_URL},${env.ADMIN_URL},https://*.vercel.app,https://*.railway.app,https://*.onrender.com,http://localhost:3100,http://localhost:3101`;
    }

    // Auto-resolve root domain
    if (env.PUBLIC_ROOT_DOMAIN === 'localhost' || String(env.PUBLIC_ROOT_DOMAIN || '').endsWith('.localhost')) {
      env.PUBLIC_ROOT_DOMAIN = 'ojaly.ng';
    }

    // Ensure distinct JWT secrets
    if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      env.JWT_REFRESH_SECRET = `${env.JWT_ACCESS_SECRET || 'ojaly'}-refresh-${Date.now()}`;
    }

    // Ensure environment variables are synchronized into process.env
    for (const [key, val] of Object.entries(env)) {
      if (val !== undefined && val !== null) {
        process.env[key] = String(val);
      }
    }

    if (String(env.MONGODB_URI || '').includes('localhost') || String(env.MONGODB_URI || '').includes('127.0.0.1')) {
      console.warn('⚠️ [Ojaly Warning] MONGODB_URI is using localhost. For multi-tenant production, ensure an Atlas MongoDB URI is configured in your platform variables.');
    }
  }

  return env as Record<string, unknown>;
}
