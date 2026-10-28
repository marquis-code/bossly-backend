import { WhatsappClientService } from './whatsapp-client.service';

function setup(options: { configured?: boolean; lastInboundAt?: Date | null; fetchOk?: boolean } = {}) {
  const values: Record<string, string> = {
    'whatsapp.accessToken': options.configured === false ? '' : 'EAAG-test-token',
    'whatsapp.phoneNumberId': options.configured === false ? '' : '123456789',
    'whatsapp.platformNumber': '+2348000000000',
  };
  const config = { get: (key: string) => values[key] };
  const contact = { lastInboundAt: options.lastInboundAt ?? null };
  const contacts = {
    findOne: jest.fn(() => ({ lean: () => ({ exec: async () => contact }) })),
    updateOne: jest.fn(() => ({ exec: async () => ({}) })),
  };
  const create = jest.fn(async () => ({}));
  const messages = { create };
  const service = new WhatsappClientService(config as never, contacts as never, messages as never);
  return { service, create, contacts };
}

describe('WhatsApp Cloud API client', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('uses free-form text inside the 24-hour customer window', async () => {
    const ctx = setup({ lastInboundAt: new Date(Date.now() - 60_000) });
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }));
    global.fetch = fetchMock as never;
    const result = await ctx.service.send({ businessId: 'biz', phone: '08031234567', text: 'Receipt: https://ojaly.ng/receipt/x' });
    expect(result).toEqual({ sent: true, usedTemplate: false });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.type).toBe('text');
    expect(body.text.body).toContain('Receipt');
    expect(ctx.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', direction: 'outbound', phone: '2348031234567' }));
  });

  it('uses an approved template outside the window', async () => {
    const ctx = setup({ lastInboundAt: new Date(Date.now() - 48 * 3600_000) });
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.2' }] }) }));
    global.fetch = fetchMock as never;
    const result = await ctx.service.send({
      businessId: 'biz', phone: '08031234567', text: 'Daily summary',
      template: { name: 'ojaly_daily_summary', params: ['Tola Thrift', '₦2,000', '₦1,000', '₦500', '₦0', '1', 'Hoodie'] },
    });
    expect(result).toEqual({ sent: true, usedTemplate: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('ojaly_daily_summary');
    expect(body.template.components[0].parameters).toHaveLength(7);
  });

  it('does not send free text outside the window without a template', async () => {
    const ctx = setup({ lastInboundAt: new Date(Date.now() - 48 * 3600_000) });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    const result = await ctx.service.send({ businessId: 'biz', phone: '08031234567', text: 'Hello' });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('template_required');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', error: expect.stringContaining('24-hour') }));
  });

  it('logs skipped when Meta credentials are absent', async () => {
    const ctx = setup({ configured: false });
    const fetchMock = jest.fn(); global.fetch = fetchMock as never;
    const result = await ctx.service.send({ businessId: 'biz', phone: '08031234567', text: 'Hello' });
    expect(result.reason).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
  });

  it('records a failed outbound message when Graph API rejects the send', async () => {
    const ctx = setup({ lastInboundAt: new Date() });
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid token' } }) })) as never;
    const result = await ctx.service.send({ businessId: 'biz', phone: '08031234567', text: 'Hello' });
    expect(result).toEqual({ sent: false, usedTemplate: false, reason: 'send_failed' });
    expect(ctx.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Invalid token' }));
  });
});
