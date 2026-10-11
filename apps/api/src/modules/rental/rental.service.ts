import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  ProductType,
  RentalStatus,
  SubscriptionStatus,
  TrackStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';

const FALLBACK_ALBUM_PRICES: Record<number, number> = {
  24: 1290,
  48: 1990,
  72: 2990,
  120: 3990,
  240: 4990,
  360: 6990,
};

@Injectable()
export class RentalService {
  private readonly logger = new Logger(RentalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlement: EntitlementService,
  ) {}

  // ============================================================
  // PRODUTOS
  // ============================================================
  async listTrackRentalProducts(trackId: string) {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true },
    });
    if (!track) throw new NotFoundException('Faixa não encontrada');

    return this.prisma.rentalProduct.findMany({
      where: { trackId, active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        durationHours: true,
        priceCents: true,
        currency: true,
      },
    });
  }

  async listAlbumRentalProducts(albumId: string) {
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      select: { id: true },
    });
    if (!album) throw new NotFoundException('Álbum não encontrado');

    const products = await this.prisma.rentalProduct.findMany({
      where: { albumId, active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        durationHours: true,
        priceCents: true,
        currency: true,
      },
    });

    if (products.length > 0) return products;

    return Object.entries(FALLBACK_ALBUM_PRICES).map(([hours, price]) => ({
      id: `${hours}h`,
      name: this.humanDuration(Number(hours)),
      durationHours: Number(hours),
      priceCents: price,
      currency: 'BRL',
    }));
  }

  // ============================================================
  // VALIDAÇÕES
  // ============================================================
  private async hasActiveSubscription(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: new Date() },
      },
      select: { id: true },
    });
    return !!sub;
  }

  private async findActiveRental(
    userId: string,
    trackId?: string,
    albumId?: string,
  ) {
    const OR: any[] = [];
    if (trackId) OR.push({ trackId });
    if (albumId) OR.push({ albumId });
    if (OR.length === 0) return null;

    return this.prisma.rental.findFirst({
      where: {
        userId,
        status: RentalStatus.ACTIVE,
        expiresAt: { gt: new Date() },
        OR,
      },
      select: {
        id: true,
        rentalCode: true,
        expiresAt: true,
        trackId: true,
        albumId: true,
      },
    });
  }

  private async assertCanRentTrack(userId: string, trackId: string) {
    if (await this.hasActiveSubscription(userId)) {
      throw new BadRequestException(
        'Você tem assinatura ativa e já pode ouvir esta faixa. Não é preciso alugar.',
      );
    }
    const existing = await this.findActiveRental(userId, trackId);
    if (existing) {
      const data = existing.expiresAt.toLocaleDateString('pt-BR');
      throw new BadRequestException(
        `Você já alugou esta faixa. Expira em ${data}.`,
      );
    }
  }

  private async assertCanRentAlbum(userId: string, albumId: string) {
    if (await this.hasActiveSubscription(userId)) {
      throw new BadRequestException(
        'Você tem assinatura ativa e já pode ouvir este álbum. Não é preciso alugar.',
      );
    }
    const existing = await this.findActiveRental(userId, undefined, albumId);
    if (existing) {
      const data = existing.expiresAt.toLocaleDateString('pt-BR');
      throw new BadRequestException(
        `Você já alugou este álbum. Expira em ${data}.`,
      );
    }
  }

  // ============================================================
  // PEDIDO — FAIXA
  // ============================================================
  async createTrackRentalOrder(
    userId: string,
    productId: string,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey },
        select: {
          id: true,
          userId: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          items: {
            select: {
              productId: true,
              productType: true,
              unitPriceCents: true,
            },
          },
        },
      });

      if (existing) {
        const sameUser = existing.userId === userId;
        const sameProduct = existing.items[0]?.productId === productId;
        if (!sameUser || !sameProduct) {
          throw new BadRequestException('Requisição inválida.');
        }

        const product = existing.items[0]?.productId
          ? await this.prisma.rentalProduct.findUnique({
              where: { id: existing.items[0].productId },
              select: {
                id: true,
                name: true,
                durationHours: true,
                priceCents: true,
                trackId: true,
              },
            })
          : null;

        const track = product?.trackId
          ? await this.prisma.track.findUnique({
              where: { id: product.trackId },
              select: { id: true, title: true },
            })
          : null;

        return {
          order: {
            id: existing.id,
            status: existing.status,
            totalCents: existing.totalCents,
            currency: existing.currency,
            createdAt: existing.createdAt,
          },
          product: product
            ? {
                id: product.id,
                name: product.name,
                durationHours: product.durationHours,
                priceCents: product.priceCents,
              }
            : null,
          track,
          idempotent: true,
        };
      }
    }

    const product = await this.prisma.rentalProduct.findUnique({
      where: { id: productId },
      include: { track: { select: { id: true, title: true, status: true } } },
    });

    if (!product || !product.active || !product.trackId || !product.track) {
      throw new NotFoundException('Produto de aluguel não encontrado');
    }
    if (product.track.status !== TrackStatus.PUBLISHED) {
      throw new BadRequestException('Faixa não está publicada');
    }

    await this.assertCanRentTrack(userId, product.trackId);

    const finalKey =
      idempotencyKey ??
      `rental-track-${userId}-${productId}-${randomUUID()}`;

    try {
      const order = await this.prisma.order.create({
        data: {
          userId,
          status: OrderStatus.PENDING,
          totalCents: product.priceCents,
          currency: product.currency,
          idempotencyKey: finalKey,
          items: {
            create: [
              {
                productType: ProductType.RENTAL,
                productId: product.id,
                quantity: 1,
                unitPriceCents: product.priceCents,
              },
            ],
          },
        },
        select: {
          id: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
        },
      });

      return {
        order,
        product: {
          id: product.id,
          name: product.name,
          durationHours: product.durationHours,
          priceCents: product.priceCents,
        },
        track: {
          id: product.track.id,
          title: product.track.title,
        },
        idempotent: false,
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const raced = await this.prisma.order.findUnique({
          where: { idempotencyKey: finalKey },
          select: {
            id: true,
            userId: true,
            status: true,
            totalCents: true,
            currency: true,
            createdAt: true,
            items: { select: { productId: true } },
          },
        });

        if (
          raced &&
          raced.userId === userId &&
          raced.items[0]?.productId === productId
        ) {
          return {
            order: {
              id: raced.id,
              status: raced.status,
              totalCents: raced.totalCents,
              currency: raced.currency,
              createdAt: raced.createdAt,
            },
            product: {
              id: product.id,
              name: product.name,
              durationHours: product.durationHours,
              priceCents: product.priceCents,
            },
            track: {
              id: product.track.id,
              title: product.track.title,
            },
            idempotent: true,
          };
        }
        throw new BadRequestException('Requisição inválida.');
      }
      throw err;
    }
  }

  // ============================================================
  // PEDIDO — ÁLBUM
  // ============================================================
  async createAlbumRentalOrder(
    userId: string,
    albumId: string,
    durationHours: number,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey },
        select: {
          id: true,
          userId: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          items: {
            select: { productId: true, productType: true },
          },
        },
      });

      if (existing) {
        const product = existing.items[0]?.productId
          ? await this.prisma.rentalProduct.findUnique({
              where: { id: existing.items[0].productId },
              select: { id: true, albumId: true, durationHours: true },
            })
          : null;

        const sameUser = existing.userId === userId;
        const sameAlbum = product?.albumId === albumId;
        const sameDuration = product?.durationHours === durationHours;

        if (!sameUser || !sameAlbum || !sameDuration) {
          throw new BadRequestException('Requisição inválida.');
        }

        const album = await this.prisma.album.findUnique({
          where: { id: albumId },
          select: {
            id: true,
            title: true,
            _count: {
              select: {
                tracks: { where: { status: TrackStatus.PUBLISHED } },
              },
            },
          },
        });

        return {
          order: {
            id: existing.id,
            status: existing.status,
            totalCents: existing.totalCents,
            currency: existing.currency,
            createdAt: existing.createdAt,
          },
          album: album
            ? {
                id: album.id,
                title: album.title,
                trackCount: album._count.tracks,
                durationHours,
                priceCents: existing.totalCents,
              }
            : null,
          idempotent: true,
        };
      }
    }

    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      include: {
        tracks: {
          where: { status: TrackStatus.PUBLISHED },
          select: { id: true },
        },
      },
    });

    if (!album) throw new NotFoundException('Álbum não encontrado');
    if (album.tracks.length === 0) {
      throw new BadRequestException('Álbum sem faixas publicadas');
    }

    const product = await this.prisma.rentalProduct.findFirst({
      where: { albumId, durationHours, active: true },
      select: { id: true, priceCents: true, currency: true },
    });

    if (!product) {
      if (!FALLBACK_ALBUM_PRICES[durationHours]) {
        throw new BadRequestException('Duração inválida');
      }
      throw new BadRequestException(
        'Produto de aluguel não configurado para esta duração. Contate o suporte.',
      );
    }

    await this.assertCanRentAlbum(userId, albumId);

    const finalKey =
      idempotencyKey ??
      `rental-album-${userId}-${albumId}-${durationHours}-${randomUUID()}`;

    try {
      const order = await this.prisma.order.create({
        data: {
          userId,
          status: OrderStatus.PENDING,
          totalCents: product.priceCents,
          currency: product.currency,
          idempotencyKey: finalKey,
          items: {
            create: [
              {
                productType: ProductType.RENTAL,
                productId: product.id,
                quantity: 1,
                unitPriceCents: product.priceCents,
              },
            ],
          },
        },
        select: {
          id: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
        },
      });

      return {
        order,
        album: {
          id: album.id,
          title: album.title,
          trackCount: album.tracks.length,
          durationHours,
          priceCents: product.priceCents,
        },
        idempotent: false,
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const raced = await this.prisma.order.findUnique({
          where: { idempotencyKey: finalKey },
          select: {
            id: true,
            userId: true,
            status: true,
            totalCents: true,
            currency: true,
            createdAt: true,
            items: { select: { productId: true } },
          },
        });

        if (raced && raced.userId === userId) {
          return {
            order: {
              id: raced.id,
              status: raced.status,
              totalCents: raced.totalCents,
              currency: raced.currency,
              createdAt: raced.createdAt,
            },
            album: {
              id: album.id,
              title: album.title,
              trackCount: album.tracks.length,
              durationHours,
              priceCents: raced.totalCents,
            },
            idempotent: true,
          };
        }
        throw new BadRequestException('Requisição inválida.');
      }
      throw err;
    }
  }

  // ============================================================
  // MOCK PAY
  // ============================================================
  async mockPayTrack(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Pedido não encontrado');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Pedido já foi processado');
    }
    if (order.items.length !== 1) {
      throw new BadRequestException('Pedido inválido');
    }

    const item = order.items[0];
    if (!item || item.productType !== ProductType.RENTAL || !item.productId) {
      throw new BadRequestException('Pedido inválido');
    }

    const product = await this.prisma.rentalProduct.findUnique({
      where: { id: item.productId },
    });
    if (!product || !product.trackId) {
      throw new NotFoundException('Produto de faixa não encontrado');
    }
    if (order.totalCents !== product.priceCents) {
      throw new BadRequestException(
        'Preço do produto diverge do pedido. Refaça o pedido.',
      );
    }

    const startsAt = new Date();
    const expiresAt = new Date(
      startsAt.getTime() + product.durationHours * 60 * 60 * 1000,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PAID,
          paidAt: new Date(),
          externalPaymentId: `mock-${randomUUID()}`,
        },
      });

      const rental = await tx.rental.create({
        data: {
          rentalCode: await this.generateRentalCodeTx(tx),
          userId,
          trackId: product.trackId,
          albumId: null,
          orderId: order.id,
          status: RentalStatus.ACTIVE,
          startsAt,
          expiresAt,
        },
      });

      return { updatedOrder, rental };
    });

    await this.entitlement.invalidateUser(userId);
    return result;
  }

  async mockPayAlbum(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Pedido não encontrado');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Pedido já foi processado');
    }

    const item = order.items[0];
    if (!item || item.productType !== ProductType.RENTAL || !item.productId) {
      throw new BadRequestException('Pedido inválido');
    }

    const product = await this.prisma.rentalProduct.findUnique({
      where: { id: item.productId },
    });
    if (!product || !product.albumId) {
      throw new NotFoundException('Produto de álbum não encontrado');
    }
    if (order.totalCents !== product.priceCents) {
      throw new BadRequestException(
        'Preço do produto diverge do pedido. Refaça o pedido.',
      );
    }

    const albumTracks = await this.prisma.track.findMany({
      where: { albumId: product.albumId, status: TrackStatus.PUBLISHED },
      select: { id: true },
    });

    if (albumTracks.length === 0) {
      throw new BadRequestException('Álbum sem faixas publicadas');
    }

    const startsAt = new Date();
    const expiresAt = new Date(
      startsAt.getTime() + product.durationHours * 60 * 60 * 1000,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PAID,
          paidAt: new Date(),
          externalPaymentId: `mock-album-${randomUUID()}`,
        },
      });

      const rentals = [];
      for (let i = 0; i < albumTracks.length; i++) {
        const rental = await tx.rental.create({
          data: {
            rentalCode: await this.generateRentalCodeTx(tx, i),
            userId,
            trackId: albumTracks[i].id,
            albumId: product.albumId,
            orderId: order.id,
            status: RentalStatus.ACTIVE,
            startsAt,
            expiresAt,
          },
        });
        rentals.push(rental);
      }

      return { updatedOrder, rentals };
    });

    await this.entitlement.invalidateUser(userId);

    return {
      order: {
        id: result.updatedOrder.id,
        status: 'PAID',
        totalCents: result.updatedOrder.totalCents,
      },
      rentals: result.rentals.length,
      firstCode: result.rentals[0]?.rentalCode ?? null,
      expiresAt,
    };
  }

  // ============================================================
  // LISTAGEM
  // ============================================================
  async listMyRentals(userId: string) {
    const now = new Date();

    const rentals = await this.prisma.rental.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            slug: true,
            album: { select: { id: true, title: true, slug: true } },
          },
        },
        album: {
          select: { id: true, title: true, slug: true },
        },
      },
    });

    return rentals.map((r) => {
      const isExpired =
        r.status === RentalStatus.ACTIVE &&
        r.expiresAt.getTime() < now.getTime();
      const effectiveStatus = isExpired ? 'EXPIRED' : r.status;

      return {
        id: r.id,
        rentalCode: r.rentalCode,
        status: effectiveStatus,
        startsAt: r.startsAt,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        orderId: r.orderId, // <-- ADICIONADO para o polling do frontend
        track: r.track,
        album: r.album,
      };
    });
  }

  // ============================================================
  // JOB
  // ============================================================
  async expireOutdatedRentals(): Promise<number> {
    const now = new Date();

    const affected = await this.prisma.rental.findMany({
      where: {
        status: RentalStatus.ACTIVE,
        expiresAt: { lt: now },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    if (affected.length === 0) return 0;

    const result = await this.prisma.rental.updateMany({
      where: {
        status: RentalStatus.ACTIVE,
        expiresAt: { lt: now },
      },
      data: { status: RentalStatus.EXPIRED },
    });

    if (result.count > 0) {
      await Promise.all(
        affected.map((r) => this.entitlement.invalidateUser(r.userId)),
      );
      this.logger.log(
        `Expirou ${result.count} aluguel(is) de ${affected.length} usuário(s)`,
      );
    }

    return result.count;
  }

  // ============================================================
  // HELPERS
  // ============================================================
  private humanDuration(hours: number): string {
    if (hours < 24) return `${hours} horas`;
    if (hours === 24) return '24 horas';
    if (hours === 48) return '48 horas';
    const days = hours / 24;
    return `${days} dias`;
  }

  private async generateRentalCodeTx(
    tx: any,
    offset = 0,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `JMM-AL-${year}-`;

    const counter = await tx.rentalCodeCounter.upsert({
      where: { year },
      create: { year, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
      select: { lastSeq: true },
    });

    const seq = counter.lastSeq + offset;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }
}