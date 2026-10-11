import { Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}