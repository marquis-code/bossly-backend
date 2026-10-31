import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data?: { authorization_url: string; access_code: string; reference: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data?: {
    id: number;
    status: string;
    reference: string;
    amount: number;
    gateway_response?: string;
    paid_at?: string;
    channel?: string;
    currency?: string;
    customer?: { email?: string };
    authorization?: { channel?: string };
    metadata?: Record<string, unknown>;
    plan?: string;
    subscription_code?: string;
  };
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get('paystack.secretKey'));
  }

  get publicKey(): string | null {
    return this.config.get('paystack.publicKey') || null;
  }

  async initialize(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
    planCode?: string | null;
  }): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('Payments are not configured yet. Add PAYSTACK_SECRET_KEY to enable payment links.');
    }
    if (input.amountKobo < 100) throw new BadGatewayException('Paystack requires at least ₦1.');
    const body: Record<string, unknown> = {
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: { app: 'ojaly', ...input.metadata },
      currency: 'NGN',
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
    };
    if (input.planCode) body.plan = input.planCode;
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get('paystack.secretKey')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await response.json().catch(() => ({}))) as PaystackInitResponse;
    if (!response.ok || !data.status || !data.data) {
      this.logger.error(`Paystack initialize failed: ${data.message || response.status}`);
      throw new BadGatewayException(data.message || 'Paystack could not start this payment.');
    }
    return {
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
    };
  }

  async verify(reference: string): Promise<PaystackVerifyResponse['data'] | null> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('Payments are not configured yet.');
    }
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${this.config.get('paystack.secretKey')}` },
      signal: AbortSignal.timeout(20000),
    });
    const data = (await response.json().catch(() => ({}))) as PaystackVerifyResponse;
    if (!response.ok || !data.status) {
      this.logger.warn(`Paystack verify failed for ${reference}`);
      return null;
    }
    return data.data || null;
  }

  async refund(reference: string, amountKobo?: number): Promise<{ status: boolean; message: string; data?: Record<string, unknown> }> {
    if (!this.isConfigured) throw new ServiceUnavailableException('Payments are not configured yet.');
    const body: Record<string, unknown> = { transaction: reference };
    if (amountKobo) body.amount = amountKobo;
    const response = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get('paystack.secretKey')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await response.json().catch(() => ({}))) as { status: boolean; message: string; data?: Record<string, unknown> };
    if (!response.ok || !data.status) {
      this.logger.error(`Paystack refund failed: ${data.message || response.status}`);
      throw new BadGatewayException(data.message || 'Paystack could not process this refund.');
    }
    return data;
  }

  get webhookSecret(): string | null {
    return this.config.get('paystack.webhookSecret') || this.config.get('paystack.secretKey') || null;
  }
}
