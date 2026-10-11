import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EntitlementService } from '../entitlement/entitlement.service';

@Injectable()
export class PlaybackService {
  private readonly logger = new Logger(PlaybackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly entitlement: EntitlementService,
  ) {}

  async authorize(trackId: string, userId: string | null) {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        slug: true,
        previewKey: true,
        streamKey: true,
      },
    });

    if (!track) throw new NotFoundException('Faixa não encontrada');

    const decision = await this.entitlement.canPlay(userId, trackId);

    if (!decision.allowed) {
      throw new ForbiddenException(decision.reason);
    }

    const usePreview = decision.source === 'preview';
    const key = usePreview ? track.previewKey : track.streamKey;

    if (!key) {
      throw new ForbiddenException(
        usePreview
          ? 'Preview não disponível para esta faixa.'
          : 'Áudio completo indisponível no momento. Contate o suporte.',
      );
    }

    // Defesa em profundidade: a key no banco precisa estar no
    // prefixo correto. Impede que um admin coloque um master em
    // streamKey por engano e vaze áudio de alta qualidade.
    try {
      this.storage.assertKeyMatchesType(
        key,
        usePreview ? 'preview' : 'stream',
      );
    } catch (e) {
      this.logger.error(
        `Track ${track.id} tem key inconsistente (${key}): ${(e as Error).message}`,
      );
      throw new ForbiddenException('Áudio indisponível no momento.');
    }

    const { url, expiresAt } = await this.storage.getPlaybackUrl(key);

    if (userId) {
      await this.prisma.playbackEvent.create({
        data: {
          userId,
          trackId,
          source: decision.source,
          secondsPlayed: 0,
        },
      });
    }

    return {
      trackId: track.id,
      title: track.title,
      slug: track.slug,
      url,
      expiresAt,
      source: decision.source,
      isPreview: usePreview,
    };
  }
}