import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeNigerianPhone } from '../../common/utils/phone';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get('sms.apiKey') && this.config.get('sms.senderId'));
  }

  get provider(): string {
    return this.config.get('sms.provider') || 'termii';
  }

  async send(input: { to: string; message: string }): Promise<{ sent: boolean; reason?: string }> {
    const phone = normalizeNigerianPhone(input.to);
    if (!phone) return { sent: false, reason: 'invalid_phone' };
    if (!this.isConfigured) return { sent: false, reason: 'not_configured' };
    try {
      const response = await fetch(`${this.config.get('sms.baseUrl')}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.config.get('sms.apiKey'),
          to: phone,
          from: this.config.get('sms.senderId'),
          sms: input.message.slice(0, 480),
          type: 'plain',
          channel: 'generic',
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      if (!response.ok || (data.code && data.code !== 'ok')) {
        this.logger.warn(`SMS failed (${response.status}): ${data.message || data.code || 'unknown'}`);
        return { sent: false, reason: 'provider_rejected' };
      }
      return { sent: true };
    } catch (error) {
      this.logger.warn(`SMS failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { sent: false, reason: 'network_error' };
    }
  }
}
