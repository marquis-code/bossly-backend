import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @Get()
  async check() {
    const db = this.connection.readyState === 1 ? 'up' : 'down';
    if (db !== 'up') {
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'ojaly-api',
        db,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: 'ok',
      service: 'ojaly-api',
      db,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
