import { Injectable, Logger } from '@nestjs/common';
import {
  RentalStatus,
  SubscriptionStatus,
  TrackStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface EntitlementResult {
  allowed: boolean;
  reason: string;
  source: 'subscription' | 'rental' | 'preview' | 'admin' | 'none';
}

const CACHE_TTL_SECONDS = parseInt(
  process.env.ENTITLEMENT_CACHE_TTL ?? '10',
  10,
);

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canPlay(
    userId: string | null,
    trackId: string,
  ): Promise<EntitlementResult> {
    if (!userId) {
      return this.computeEntitlement(null, trackId);
    }

    const cacheKey = `ent:${userId}:${trackId}`;
    const cached = await this.redis.get<EntitlementResult>(cacheKey);
    if (cached) return cached;

    const result = await this.computeEntitlement(userId, trackId);
    void this.redis.setex(cacheKey, CACHE_TTL_SECONDS, result);
    return result;
  }

  async invalidateUser(userId: string): Promise<void> {
    const deleted = await this.redis.delPattern(`ent:${userId}:*`);
    if (deleted > 0) {
      this.logger.log(
        `Cache invalidado: ${deleted} chaves (user ${userId})`,
      );
    }
  }

  async invalidateTrack(userId: string, trackId: string): Promise<void> {
    await this.redis.del(`ent:${userId}:${trackId}`);
  }

  async invalidateAlbum(userId: string, _albumId: string): Promise<void> {
    // Não temos albumId no cacheKey — invalida tudo do usuário.
    await this.invalidateUser(userId);
  }

  private async computeEntitlement(
    userId: string | null,
    trackId: string,
  ): Promise<EntitlementResult> {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        status: true,
        albumId: true,
        previewKey: true,
        streamKey: true,
      },
    });

    if (!track) {
      return { allowed: false, reason: 'Faixa não encontrada', source: 'none' };
    }
    if (track.status !== TrackStatus.PUBLISHED) {
      return { allowed: false, reason: 'Faixa não publicada', source: 'none' };
    }
    if (!track.streamKey && !track.previewKey) {
      return {
        allowed: false,
        reason: 'Faixa sem áudio disponível',
        source: 'none',
      };
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role === 'ADMIN') {
        return { allowed: true, reason: 'Admin', source: 'admin' };
      }
    }

    if (userId) {
      const sub = await this.prisma.subscription.findFirst({
        where: {
          userId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: { gt: new Date() },
        },
        select: { id: true },
      });
      if (sub) {
        return {
          allowed: true,
          reason: 'Assinatura ativa',
          source: 'subscription',
        };
      }
    }

    if (userId) {
      const now = new Date();
      const rental = await this.prisma.rental.findFirst({
        where: {
          userId,
          status: RentalStatus.ACTIVE,
          startsAt: { lte: now },
          expiresAt: { gt: now },
          OR: [
            { trackId },
            ...(track.albumId ? [{ albumId: track.albumId }] : []),
          ],
        },
        select: { id: true },
      });
      if (rental) {
        return { allowed: true, reason: 'Aluguel ativo', source: 'rental' };
      }
    }

    if (track.previewKey) {
      return { allowed: true, reason: 'Preview público', source: 'preview' };
    }

    return {
      allowed: false,
      reason: 'Sem assinatura, aluguel ou preview disponível',
      source: 'none',
    };
  }
}