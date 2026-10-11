import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadUrlDto } from './dto/upload-url.dto';
import { AttachMediaDto } from './dto/attach-media.dto';

const MAX_SIZE_BY_TYPE: Record<'master' | 'stream' | 'preview', number> = {
  master: 500 * 1024 * 1024,
  stream: 100 * 1024 * 1024,
  preview: 5 * 1024 * 1024,
};

const ALLOWED_MIME: Record<
  'master' | 'stream' | 'preview',
  ReadonlyArray<string>
> = {
  master: ['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac'],
  stream: ['audio/mpeg', 'audio/mp3', 'audio/aac', 'audio/mp4', 'audio/ogg'],
  preview: ['audio/mpeg', 'audio/mp3', 'audio/aac', 'audio/mp4', 'audio/ogg'],
};

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createUploadUrl(dto: UploadUrlDto) {
    const track = await this.prisma.track.findUnique({
      where: { id: dto.trackId },
      select: { id: true, slug: true },
    });
    if (!track) throw new NotFoundException('Faixa não encontrada');

    const type = dto.type as 'master' | 'stream' | 'preview';
    if (!ALLOWED_MIME[type]) {
      throw new BadRequestException('Tipo de mídia inválido');
    }
    if (!ALLOWED_MIME[type].includes(dto.contentType)) {
      throw new BadRequestException(
        `Content-Type "${dto.contentType}" não permitido para "${type}". ` +
          `Aceitos: ${ALLOWED_MIME[type].join(', ')}`,
      );
    }

    const extension = this.extensionFromMime(dto.contentType);
    if (!extension) {
      throw new BadRequestException('Extensão não suportada');
    }

    const key = this.buildKey(type, track.slug, extension);
    const url = await this.storage.getUploadUrl(key, dto.contentType);

    return {
      url,
      key,
      expiresInSeconds: 900,
      method: 'PUT',
      headers: { 'Content-Type': dto.contentType },
      maxSizeBytes: MAX_SIZE_BY_TYPE[type],
    };
  }

  async attach(dto: AttachMediaDto) {
    const track = await this.prisma.track.findUnique({
      where: { id: dto.trackId },
      select: { id: true, slug: true },
    });
    if (!track) throw new NotFoundException('Faixa não encontrada');

    const type = dto.type as 'master' | 'stream' | 'preview';
    if (!ALLOWED_MIME[type]) {
      throw new BadRequestException('Tipo de mídia inválido');
    }

    try {
      this.storage.assertKeyMatchesType(dto.key, type);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const expectedPrefix = this.buildKeyPrefix(type, track.slug);
    if (!dto.key.startsWith(expectedPrefix)) {
      this.logger.warn(
        `Tentativa de attach com key fora do padrão: key=${dto.key} track=${track.id} type=${type}`,
      );
      throw new BadRequestException(
        'Key não corresponde à faixa ou ao tipo informado.',
      );
    }

    const head = await this.storage.headObject(dto.key);
    if (!head) {
      throw new BadRequestException(
        'Objeto não encontrado no storage. Faça o upload antes de anexar.',
      );
    }

    const size = head.ContentLength ?? 0;
    if (size <= 0) {
      throw new BadRequestException('Objeto com tamanho inválido.');
    }
    if (size > MAX_SIZE_BY_TYPE[type]) {
      throw new BadRequestException(
        `Arquivo excede o limite de ${Math.round(
          MAX_SIZE_BY_TYPE[type] / 1024 / 1024,
        )} MB para "${type}".`,
      );
    }

    const mime = (head.ContentType ?? '').toLowerCase();
    if (!mime || !ALLOWED_MIME[type].includes(mime)) {
      throw new BadRequestException(
        `Content-Type do objeto ("${mime}") não permitido para "${type}".`,
      );
    }

    const field = this.fieldForType(type);
    return this.prisma.track.update({
      where: { id: dto.trackId },
      data: { [field]: dto.key },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        previewKey: true,
        streamKey: true,
        masterKey: true,
      },
    });
  }

  private buildKeyPrefix(
    type: 'master' | 'stream' | 'preview',
    slug: string,
  ): string {
    switch (type) {
      case 'master':
        return `masters/${slug}/`;
      case 'stream':
        return `streaming/${slug}/`;
      case 'preview':
        return `previews/${slug}/`;
    }
  }

  private buildKey(
    type: 'master' | 'stream' | 'preview',
    slug: string,
    extension: string,
  ): string {
    return `${this.buildKeyPrefix(type, slug)}${type}.${extension}`;
  }

  private fieldForType(
    type: 'master' | 'stream' | 'preview',
  ): 'masterKey' | 'streamKey' | 'previewKey' {
    switch (type) {
      case 'master':
        return 'masterKey';
      case 'stream':
        return 'streamKey';
      case 'preview':
        return 'previewKey';
    }
  }

  private extensionFromMime(mime: string): string | null {
    const map: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/flac': 'flac',
      'audio/x-flac': 'flac',
      'audio/aac': 'aac',
      'audio/mp4': 'm4a',
      'audio/ogg': 'ogg',
    };
    return map[mime] ?? null;
  }
}