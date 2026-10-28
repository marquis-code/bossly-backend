import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { createHmac, timingSafeEqual } from 'crypto';
import { Model } from 'mongoose';
import { decryptText, encryptText } from '../../common/utils/crypto-box';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import {
  CalendarBusyBlock, CalendarBusyBlockDocument, CalendarConnection, CalendarConnectionDocument,
  CalendarEventLink, CalendarEventDocument, CalendarProvider,
} from './calendar.schema';

interface ExternalEvent { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; subject?: string; startAt?: string; endAt?: string; isAllDay?: boolean; }

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(CalendarConnection.name) private readonly connections: Model<CalendarConnectionDocument>,
    @InjectModel(CalendarBusyBlock.name) private readonly busy: Model<CalendarBusyBlockDocument>,
    @InjectModel(CalendarEventLink.name) private readonly links: Model<CalendarEventDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
  ) {}

  get configured(): { google: boolean; outlook: boolean } {
    return {
      google: Boolean(this.config.get('calendar.googleClientId') && this.config.get('calendar.googleClientSecret')),
      outlook: Boolean(this.config.get('calendar.outlookClientId') && this.config.get('calendar.outlookClientSecret')),
    };
  }

  async status(businessId: string) {
    const items = await this.connections.find({ businessId }).lean().exec();
    return {
      configured: this.configured,
      connections: items.map((item) => ({
        provider: item.provider, calendarId: item.calendarId, connectedAt: item.createdAt,
        lastSyncAt: item.lastSyncAt, isActive: item.isActive,
      })),
    };
  }

  connectUrl(businessId: string, provider: CalendarProvider, userId: string) {
    const state = this.signState({ businessId, provider, userId, at: Date.now() });
    if (provider === 'google') {
      if (!this.configured.google) throw new BadRequestException('Google Calendar is not configured. Add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.');
      const params = new URLSearchParams({
        client_id: String(this.config.get('calendar.googleClientId')),
        redirect_uri: this.redirectUri('google'),
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
    }
    if (!this.configured.outlook) throw new BadRequestException('Outlook Calendar is not configured. Add OUTLOOK_CALENDAR_CLIENT_ID and OUTLOOK_CALENDAR_CLIENT_SECRET.');
    const params = new URLSearchParams({
      client_id: String(this.config.get('calendar.outlookClientId')),
      redirect_uri: this.redirectUri('outlook'),
      response_type: 'code',
      scope: 'offline_access Calendars.ReadWrite',
      state,
    });
    return { url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` };
  }

  async handleCallback(provider: CalendarProvider, code: string | undefined, state: string | undefined) {
    const data = this.verifyState(state);
    if (!code) throw new BadRequestException('The calendar connection was cancelled.');
    if (data.provider !== provider) throw new BadRequestException('Calendar provider mismatch.');
    const tokens = await this.exchangeCode(provider, code);
    const encryptedAccess = encryptText(tokens.accessToken, this.tokenSecret());
    const encryptedRefresh = tokens.refreshToken ? encryptText(tokens.refreshToken, this.tokenSecret()) : null;
    await this.connections.findOneAndUpdate(
      { businessId: data.businessId, provider },
      {
        $set: {
          accessToken: encryptedAccess, refreshToken: encryptedRefresh,
          expiresAt: tokens.expiresAt, isActive: true, calendarId: 'primary',
        },
      },
      { upsert: true, new: true },
    ).exec();
    await this.sync(data.businessId, provider).catch(() => undefined);
    return { businessId: data.businessId, provider };
  }

  async disconnect(businessId: string, provider: CalendarProvider) {
    await this.connections.deleteOne({ businessId, provider }).exec();
    await this.busy.deleteMany({ businessId, provider }).exec();
    await this.links.deleteMany({ businessId, provider }).exec();
    return { disconnected: true };
  }

  async sync(businessId: string, provider?: CalendarProvider) {
    const filter: Record<string, unknown> = { businessId, isActive: true };
    if (provider) filter.provider = provider;
    const connections = await this.connections.find(filter).exec();
    let imported = 0;
    for (const connection of connections) {
      const events = await this.fetchEvents(connection);
      await this.busy.deleteMany({ businessId, provider: connection.provider }).exec();
      for (const event of events) {
        const start = new Date(event.start?.dateTime || event.start?.date || event.startAt || '');
        const end = new Date(event.end?.dateTime || event.end?.date || event.endAt || '');
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
        await this.busy.updateOne(
          { businessId, provider: connection.provider, externalId: event.id },
          { $set: { startAt: start, endAt: end, title: event.summary || event.subject || 'Busy' } },
          { upsert: true },
        ).exec();
        imported++;
      }
      connection.lastSyncAt = new Date();
      await connection.save();
    }
    return { synced: imported, connections: connections.length };
  }

  async busyForDay(businessId: string, start: Date, end: Date) {
    return this.busy.find({ businessId, startAt: { $lt: end }, endAt: { $gt: start } }).lean().exec();
  }

  async pushBooking(booking: BookingDocument) {
    const connections = await this.connections.find({ businessId: booking.businessId, isActive: true }).exec();
    for (const connection of connections) {
      try {
        const existing = await this.links.findOne({ businessId: booking.businessId, provider: connection.provider, bookingId: booking._id.toString() }).lean().exec();
        if (existing) continue;
        const event = await this.createEvent(connection, booking);
        if (event?.id) {
          await this.links.updateOne(
            { businessId: booking.businessId, provider: connection.provider, bookingId: booking._id.toString() },
            { $set: { externalId: event.id } },
            { upsert: true },
          ).exec();
        }
      } catch (error) { this.logger.warn(`Calendar push failed (${connection.provider}): ${error instanceof Error ? error.message : 'unknown'}`); }
    }
  }

  async removeBooking(booking: BookingDocument) {
    const items = await this.links.find({ businessId: booking.businessId, bookingId: booking._id.toString() }).lean().exec();
    for (const item of items) {
      const connection = await this.connections.findOne({ businessId: booking.businessId, provider: item.provider }).exec();
      if (!connection) continue;
      await this.deleteEvent(connection, item.externalId).catch(() => undefined);
      await this.links.deleteOne({ _id: item._id }).exec();
    }
  }

  async resyncBooking(booking: BookingDocument) {
    await this.removeBooking(booking);
    await this.pushBooking(booking);
  }

  @Cron('*/15 * * * *', { name: 'calendar-sync' })
  async syncAll() {
    const connections = await this.connections.find({ isActive: true }).select('businessId provider').lean().exec();
    const seen = new Set<string>();
    for (const connection of connections) {
      const key = `${connection.businessId}:${connection.provider}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.sync(connection.businessId, connection.provider).catch(() => undefined);
    }
  }

  private async fetchEvents(connection: CalendarConnectionDocument): Promise<ExternalEvent[]> {
    const token = await this.accessToken(connection);
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const to = new Date(Date.now() + 120 * 86400000).toISOString();
    const url = connection.provider === 'google'
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}&singleEvents=true&orderBy=startTime&maxResults=2500`
      : `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}&$top=1000`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Calendar read failed (${response.status})`);
    const data = (await response.json()) as { items?: ExternalEvent[]; value?: ExternalEvent[] };
    return data.items || data.value || [];
  }

  private async createEvent(connection: CalendarConnectionDocument, booking: BookingDocument) {
    const token = await this.accessToken(connection);
    const description = `Ojaly booking ${booking.bookingNumber}. ${booking.providerName}. ${booking.customerName}. ${booking.notes || ''}`;
    const body = connection.provider === 'google'
      ? { summary: `${booking.serviceName} · ${booking.customerName}`, description, location: '', start: { dateTime: booking.startAt.toISOString() }, end: { dateTime: booking.endAt.toISOString() } }
      : { subject: `${booking.serviceName} · ${booking.customerName}`, body: { contentType: 'text', content: description }, start: { dateTime: booking.startAt.toISOString(), timeZone: booking.timezone }, end: { dateTime: booking.endAt.toISOString(), timeZone: booking.timezone } };
    const url = connection.provider === 'google'
      ? 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
      : 'https://graph.microsoft.com/v1.0/me/events';
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Calendar write failed (${response.status})`);
    return (await response.json()) as { id?: string };
  }

  private async deleteEvent(connection: CalendarConnectionDocument, externalId: string) {
    const token = await this.accessToken(connection);
    const url = connection.provider === 'google'
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(externalId)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(externalId)}`;
    await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  }

  private async accessToken(connection: CalendarConnectionDocument): Promise<string> {
    const secret = this.tokenSecret();
    if (connection.expiresAt && connection.expiresAt.getTime() > Date.now() + 60000) return decryptText(connection.accessToken, secret);
    if (!connection.refreshToken) return decryptText(connection.accessToken, secret);
    const refresh = decryptText(connection.refreshToken, secret);
    const tokens = await this.refreshToken(connection.provider, refresh);
    connection.accessToken = encryptText(tokens.accessToken, secret);
    if (tokens.refreshToken) connection.refreshToken = encryptText(tokens.refreshToken, secret);
    connection.expiresAt = tokens.expiresAt;
    await connection.save();
    return tokens.accessToken;
  }

  private async exchangeCode(provider: CalendarProvider, code: string) {
    const params = new URLSearchParams(provider === 'google' ? {
      code, client_id: String(this.config.get('calendar.googleClientId')),
      client_secret: String(this.config.get('calendar.googleClientSecret')),
      redirect_uri: this.redirectUri('google'), grant_type: 'authorization_code',
    } : {
      code, client_id: String(this.config.get('calendar.outlookClientId')),
      client_secret: String(this.config.get('calendar.outlookClientSecret')),
      redirect_uri: this.redirectUri('outlook'), grant_type: 'authorization_code',
    });
    const url = provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    return this.tokenRequest(url, params);
  }

  private async refreshToken(provider: CalendarProvider, refreshToken: string) {
    const params = new URLSearchParams(provider === 'google' ? {
      refresh_token: refreshToken, client_id: String(this.config.get('calendar.googleClientId')),
      client_secret: String(this.config.get('calendar.googleClientSecret')), grant_type: 'refresh_token',
    } : {
      refresh_token: refreshToken, client_id: String(this.config.get('calendar.outlookClientId')),
      client_secret: String(this.config.get('calendar.outlookClientSecret')), grant_type: 'refresh_token',
    });
    const url = provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    return this.tokenRequest(url, params);
  }

  private async tokenRequest(url: string, params: URLSearchParams) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(20000) });
    const data = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !data.access_token) throw new BadRequestException(data.error_description || data.error || 'Calendar authorization failed.');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  }

  private redirectUri(provider: CalendarProvider) {
    return provider === 'google'
      ? (this.config.get('calendar.googleRedirectUri') || `${this.config.get('apiUrl')}/calendar/google/callback`)
      : (this.config.get('calendar.outlookRedirectUri') || `${this.config.get('apiUrl')}/calendar/outlook/callback`);
  }

  private tokenSecret(): string {
    return String(this.config.get('calendar.tokenSecret') || 'ojaly-calendar-token-secret');
  }

  private signState(payload: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyState(state?: string): { businessId: string; provider: CalendarProvider; userId: string; at: number } {
    if (!state) throw new BadRequestException('Missing calendar state.');
    const [body, sig] = state.split('.');
    if (!body || !sig) throw new BadRequestException('Invalid calendar state.');
    const expected = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) throw new BadRequestException('Invalid calendar state.');
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as { businessId: string; provider: CalendarProvider; userId: string; at: number };
    if (Date.now() - data.at > 15 * 60 * 1000) throw new BadRequestException('Calendar connection expired. Try again.');
    return data;
  }
}
