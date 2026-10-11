import {
  Controller,
  Get,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './modules/redis/redis.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {
          database: 'ok',
          redis: 'ok',
        },
      };
    } catch {
      throw new InternalServerErrorException('Database or Redis unavailable');
    }
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {
          database: 'ok',
          redis: 'ok',
        },
      };
    } catch {
      throw new InternalServerErrorException('Service not ready');
    }
  }
}
