import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type StorageDriver = 'rustfs' | 'b2';

const ALLOWED_PREFIXES = [
  'masters/',
  'streaming/',
  'previews/',
  'covers/',
  'artists/',
] as const;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  private bucket!: string;
  private publicBaseUrl: string | null = null;
  private uploadExpires = 900;
  private playbackExpires = 300;
  private imageExpires = 31536000;
  private driver: StorageDriver = 'rustfs';
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  private getConfigValue(...keys: string[]): string {
    for (const key of keys) {
      const value = this.config.get<string>(key);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    throw new Error(
      `Configuração de storage ausente. Defina uma das chaves: ${keys.join(', ')}`,
    );
  }

  onModuleInit() {
    const driver = (this.config.get<string>('STORAGE_DRIVER', 'rustfs') ??
      'rustfs') as StorageDriver;
    this.driver = driver;

    try {
      if (driver === 'b2') {
        const endpoint = this.getConfigValue('B2_MEDIA_ENDPOINT', 'B2_ENDPOINT');
        const region = this.getConfigValue('B2_MEDIA_REGION', 'B2_REGION');
        const accessKeyId = this.getConfigValue('B2_KEY_ID');
        const secretAccessKey = this.getConfigValue('B2_APPLICATION_KEY');

        this.bucket = this.getConfigValue('B2_MEDIA_BUCKET', 'B2_BUCKET');
        this.publicBaseUrl =
          this.config.get<string>('B2_IMAGE_PUBLIC_URL') ??
          this.config.get<string>('B2_PUBLIC_URL') ??
          null;

        this.client = new S3Client({
          region,
          endpoint,
          credentials: { accessKeyId, secretAccessKey },
          forcePathStyle: true,
        });
      } else {
        const endpoint = this.getConfigValue('S3_ENDPOINT');
        const region = this.getConfigValue('S3_REGION', 'us-east-1');
        const accessKeyId = this.getConfigValue('S3_ACCESS_KEY');
        const secretAccessKey = this.getConfigValue('S3_SECRET_KEY');
        const forcePathStyle =
          this.config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true';

        this.bucket = this.getConfigValue('S3_BUCKET');
        this.client = new S3Client({
          region,
          endpoint,
          credentials: { accessKeyId, secretAccessKey },
          forcePathStyle,
        });
      }

      this.uploadExpires = parseInt(
        this.config.get<string>('SIGNED_URL_UPLOAD_EXPIRES', '900'),
        10,
      );
      this.playbackExpires = parseInt(
        this.config.get<string>('SIGNED_URL_PLAYBACK_EXPIRES', '300'),
        10,
      );
      this.imageExpires = parseInt(
        this.config.get<string>('SIGNED_URL_IMAGE_EXPIRES', '31536000'),
        10,
      );

      this.configured = true;
      this.logger.log(
        `Storage pronto: ${this.driver.toUpperCase()} • bucket=${this.bucket} • playbackTTL=${this.playbackExpires}s`,
      );
    } catch (error) {
      this.logger.warn(
        `Storage não configurado: ${(error as Error).message}. Uploads e URLs assinadas indisponíveis.`,
      );
      this.configured = false;
    }
  }

  getDriver(): StorageDriver {
    return this.driver;
  }

  getBucket(): string {
    return this.bucket;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private assertSafeKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('Key obrigatória');
    }
    if (key.length > 512) {
      throw new Error('Key excessivamente longa');
    }
    if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
      throw new Error('Key inválida (path traversal)');
    }
    if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      throw new Error(
        `Key fora dos prefixos permitidos: ${ALLOWED_PREFIXES.join(', ')}`,
      );
    }
  }

  assertKeyMatchesType(
    key: string,
    type: 'master' | 'stream' | 'preview',
  ): void {
    this.assertSafeKey(key);
    const prefix =
      type === 'master'
        ? 'masters/'
        : type === 'stream'
          ? 'streaming/'
          : 'previews/';
    if (!key.startsWith(prefix)) {
      throw new Error(
        `Key "${key}" não corresponde ao tipo "${type}" (esperado prefixo "${prefix}")`,
      );
    }
  }

  async getUploadUrl(key: string, contentType: string): Promise<string> {
    this.assertSafeKey(key);
    if (!this.configured) throw new Error('Storage não configurado.');
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: this.uploadExpires,
    });
  }

  async getPlaybackUrl(key: string): Promise<{ url: string; expiresAt: Date }> {
    this.assertSafeKey(key);
    if (!this.configured) throw new Error('Storage não configurado.');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.playbackExpires,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + this.playbackExpires * 1000),
    };
  }

  async getImageUrl(key: string): Promise<string> {
    this.assertSafeKey(key);
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    }
    if (!this.configured) throw new Error('Storage não configurado.');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: this.imageExpires });
  }

  async objectExists(key: string): Promise<boolean> {
    if (!key || !this.configured) return false;
    try {
      this.assertSafeKey(key);
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async headObject(key: string): Promise<HeadObjectCommandOutput | null> {
    if (!key || !this.configured) return null;
    try {
      this.assertSafeKey(key);
      return await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    if (!key || !this.configured) return;
    this.assertSafeKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}