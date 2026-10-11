import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await Promise.race([
        this.$connect(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('timeout ao conectar ao banco')), 
            2000,
          ),
        ),
      ]);
    } catch (error) {
      this.logger.warn(
        `Prisma não conseguiu conectar com o banco local. A API continuará iniciando em modo degradado: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (error) {
      this.logger.warn(`Prisma disconnect falhou: ${(error as Error).message}`);
    }
  }
}