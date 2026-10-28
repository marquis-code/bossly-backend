import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  sign(businessId: string, purpose: string) {
    const cloudName = this.config.get<string>('cloudinary.cloudName');
    const apiKey = this.config.get<string>('cloudinary.apiKey');
    const apiSecret = this.config.get<string>('cloudinary.apiSecret');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Image uploads are not configured yet. Add your Cloudinary keys.');
    }
    const base = this.config.get<string>('cloudinary.folder') || 'ojaly';
    const timestamp = Math.round(Date.now() / 1000);
    const folder = `${base}/${businessId}/${purpose}`;
    const isVideo = purpose === 'video';
    const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, apiSecret);
    return {
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${isVideo ? 'video' : 'image'}/upload`,
      resourceType: isVideo ? 'video' : 'image',
      maxBytes: isVideo ? 50 * 1024 * 1024 : 8 * 1024 * 1024,
      allowedFormats: isVideo ? ['mp4', 'webm', 'mov'] : ['jpg', 'jpeg', 'png', 'webp'],
    };
  }
}
