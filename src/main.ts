import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { Business, BusinessDocument } from './modules/businesses/business.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const allowed = config.get<string[]>('allowedOrigins') || [];
  const rootDomain = config.get<string>('publicRootDomain') || 'ojaly.ng';
  const businessModel = app.get<Model<BusinessDocument>>(getModelToken(Business.name));
  const customDomainCache = new Map<string, { allowed: boolean; expires: number }>();
  const matchesAllowedOrigin = (origin: string) => allowed.some((pattern) => {
    if (!pattern.includes('*')) return pattern === origin;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(origin);
  });
  const isVerifiedCustomDomain = async (host: string): Promise<boolean> => {
    const cached = customDomainCache.get(host);
    if (cached && cached.expires > Date.now()) return cached.allowed;
    const exists = await businessModel.exists({ customDomain: host, customDomainVerified: true, storefrontPublished: true });
    const result = Boolean(exists);
    customDomainCache.set(host, { allowed: result, expires: Date.now() + 5 * 60 * 1000 });
    return result;
  };

  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  app.use(requestIdMiddleware);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (matchesAllowedOrigin(origin)) return callback(null, true);
      let host: string;
      try {
        host = new URL(origin).hostname;
        if (host === rootDomain || host.endsWith(`.${rootDomain}`) || host === 'localhost' || host.endsWith('.localhost')) {
          return callback(null, true);
        }
      } catch {
        return callback(null, false);
      }
      // Storefronts on verified custom domains need to call the public API from
      // their own origin. Cache the DB check to avoid a lookup on every request.
      void isVerifiedCustomDomain(host.replace(/^www\./, ''))
        .then((isCustomDomain) => callback(null, isCustomDomain))
        .catch(() => callback(null, false));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Business-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
  });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ojaly API')
    .setDescription(
      'Business management and auto-generated storefronts for Nigerian student entrepreneurs. All money values are integer kobo (₦1 = 100 kobo). Send the JWT as a Bearer token.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('/api/v1')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Ojaly API Docs',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });

  if (config.get('env') === 'production') {
    const missing = [
      ['CLOUDINARY_CLOUD_NAME', config.get('cloudinary.cloudName')],
      ['RESEND_API_KEY', config.get('resend.apiKey')],
      ['PAYSTACK_SECRET_KEY', config.get('paystack.secretKey')],
      ['WHATSAPP_ACCESS_TOKEN', config.get('whatsapp.accessToken')],
      ['WHATSAPP_PHONE_NUMBER_ID', config.get('whatsapp.phoneNumberId')],
      ['WHATSAPP_APP_SECRET', config.get('whatsapp.appSecret')],
      ['WHATSAPP_PLATFORM_NUMBER', config.get('whatsapp.platformNumber')],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      // These features degrade explicitly; do not fail a deploy for optional providers.
      // The admin WhatsApp health page and API responses expose the same readiness state.
      // eslint-disable-next-line no-console
      console.warn(`[config] Production integrations not configured: ${missing.join(', ')}`);
    }
    if (config.get('whatsapp.verifyToken') === 'ojaly-webhook-verify') {
      // eslint-disable-next-line no-console
      console.warn('[config] WHATSAPP_VERIFY_TOKEN is still the development default.');
    }
  }

  const port = Number(config.get('port') || 4100);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Ojaly API on http://localhost:${port}/api/v1 · docs http://localhost:${port}/docs`);
}
void bootstrap();
