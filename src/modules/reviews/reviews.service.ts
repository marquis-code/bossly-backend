import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { randomToken } from '../../common/utils/tokens';
import { sanitizeText } from '../../common/utils/sanitize';
import { Review, ReviewDocument, ReviewStatus } from './review.schema';
import { ReviewQueryDto, SubmitReviewDto } from './review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async context(token: string) {
    const booking = await this.bookings.findOne({ reviewToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Review link not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    const existing = await this.reviews.findOne({ bookingId: booking._id.toString() }).lean().exec();
    return {
      booking: {
        id: booking._id.toString(), bookingNumber: booking.bookingNumber,
        serviceId: booking.serviceId, serviceName: booking.serviceName,
        providerName: booking.providerName, customerName: booking.customerName,
        startAt: booking.startAt, status: booking.status,
      },
      business: business ? {
        id: business._id.toString(), name: business.name, slug: business.slug,
        logoUrl: business.logoUrl, brandColor: business.brandColor,
      } : null,
      review: existing ? this.view(existing) : null,
      canReview: booking.status === 'completed' && !existing,
    };
  }

  async submit(token: string, dto: SubmitReviewDto) {
    const booking = await this.bookings.findOne({ reviewToken: token }).exec();
    if (!booking) throw new NotFoundException('Review link not found.');
    if (booking.status !== 'completed') throw new BadRequestException('You can review an appointment after it is completed.');
    const existing = await this.reviews.findOne({ bookingId: booking._id.toString() }).lean().exec();
    if (existing) throw new BadRequestException('This appointment has already been reviewed.');
    const review = await this.reviews.create({
      businessId: booking.businessId,
      bookingId: booking._id.toString(),
      serviceId: booking.serviceId,
      serviceName: booking.serviceName,
      providerId: booking.providerId,
      providerName: booking.providerName,
      customerId: booking.customerId,
      customerName: booking.customerName,
      rating: dto.rating,
      comment: sanitizeText(dto.comment, 1000),
      publicToken: randomToken(20),
      status: 'published',
    });
    booking.reviewedAt = new Date();
    await booking.save();
    await this.notifications.create({
      businessId: booking.businessId, type: 'booking', tone: dto.rating >= 4 ? 'success' : 'info',
      title: `${dto.rating}-star review for ${booking.serviceName}`,
      message: `${booking.customerName}: ${dto.comment || 'No comment left.'}`,
      data: { reviewId: review._id.toString(), bookingId: booking._id.toString() },
    });
    return this.view(review);
  }

  async list(businessId: string, query: ReviewQueryDto) {
    const filter: Record<string, unknown> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    const [items, all] = await Promise.all([
      this.reviews.find(filter).sort({ createdAt: -1 }).limit(200).lean().exec(),
      this.reviews.find({ businessId, status: 'published' }).select('rating').lean().exec(),
    ]);
    const average = all.length ? all.reduce((sum, review) => sum + review.rating, 0) / all.length : 0;
    return {
      items: items.map((review) => this.view(review)),
      summary: {
        total: all.length,
        average: Math.round(average * 10) / 10,
        fiveStar: all.filter((review) => review.rating === 5).length,
        needsAttention: all.filter((review) => review.rating <= 3).length,
      },
    };
  }

  async publishedForBusiness(businessId: string, serviceId?: string) {
    const filter: Record<string, unknown> = { businessId, status: 'published' };
    if (serviceId) filter.serviceId = serviceId;
    const items = await this.reviews.find(filter).sort({ createdAt: -1 }).limit(6).lean().exec();
    const average = items.length ? items.reduce((sum, review) => sum + review.rating, 0) / items.length : 0;
    return {
      items: items.map((review) => ({
        id: review.publicToken, rating: review.rating, comment: review.comment,
        customerName: review.customerName, serviceName: review.serviceName,
        providerName: review.providerName, createdAt: review.createdAt,
      })),
      average: Math.round(average * 10) / 10,
      count: items.length,
    };
  }

  async setStatus(businessId: string, id: string, status: ReviewStatus) {
    const review = await this.reviews.findOneAndUpdate({ _id: id, businessId }, { $set: { status } }, { new: true }).lean().exec();
    if (!review) throw new NotFoundException('Review not found.');
    return this.view(review);
  }

  async remove(businessId: string, id: string) {
    const result = await this.reviews.deleteOne({ _id: id, businessId }).exec();
    if (!result.deletedCount) throw new NotFoundException('Review not found.');
    return { removed: true };
  }

  reviewUrl(token: string | null) {
    return token ? `${this.config.get('appUrl')}/review/${token}` : null;
  }

  private view(review: ReviewDocument | (Review & { _id: unknown })) {
    const r = review as ReviewDocument;
    return {
      id: r._id.toString(), bookingId: r.bookingId, serviceId: r.serviceId, serviceName: r.serviceName,
      providerId: r.providerId, providerName: r.providerName, customerId: r.customerId,
      customerName: r.customerName, rating: r.rating, comment: r.comment,
      publicToken: r.publicToken, status: r.status, createdAt: r.createdAt,
    };
  }
}
