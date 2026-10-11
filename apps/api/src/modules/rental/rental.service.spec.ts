import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { RedisService } from '../redis/redis.service';
import { RentalService } from './rental.service';

describe('RentalService — idempotência', () => {
  let service: RentalService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        RentalService,
        PrismaService,
        EntitlementService,
        RedisService,
      ],
    }).compile();

    service = mod.get(RentalService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('devolve o mesmo pedido em chamada idempotente do mesmo usuário', async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
        passwordHash: 'x',
      },
    });
    const artist = await prisma.artist.create({
      data: { name: `Artist ${Date.now()}`, slug: `artist-${Date.now()}` },
    });
    const track = await prisma.track.create({
      data: {
        title: 'T',
        slug: `t-${Date.now()}`,
        artistId: artist.id,
        status: 'PUBLISHED',
        streamKey: `streaming/${Date.now()}/stream.mp3`,
      },
    });
    const product = await prisma.rentalProduct.create({
      data: {
        trackId: track.id,
        name: '24h',
        durationHours: 24,
        priceCents: 1290,
        currency: 'BRL',
      },
    });

    const key = `test-${Date.now()}`;
    const first = await service.createTrackRentalOrder(
      user.id,
      product.id,
      key,
    );
    const second = await service.createTrackRentalOrder(
      user.id,
      product.id,
      key,
    );
    expect(second.order.id).toBe(first.order.id);
    expect(second.idempotent).toBe(true);
  });

  it('rejeita quando outro usuário reusa a idempotencyKey', async () => {
    const userA = await prisma.user.create({
      data: {
        email: `a-${Date.now()}@example.com`,
        name: 'A',
        passwordHash: 'x',
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `b-${Date.now()}@example.com`,
        name: 'B',
        passwordHash: 'x',
      },
    });
    const artist = await prisma.artist.create({
      data: { name: `Artist2 ${Date.now()}`, slug: `artist2-${Date.now()}` },
    });
    const track = await prisma.track.create({
      data: {
        title: 'T2',
        slug: `t2-${Date.now()}`,
        artistId: artist.id,
        status: 'PUBLISHED',
        streamKey: `streaming/${Date.now()}/stream.mp3`,
      },
    });
    const product = await prisma.rentalProduct.create({
      data: {
        trackId: track.id,
        name: '24h',
        durationHours: 24,
        priceCents: 1290,
        currency: 'BRL',
      },
    });

    const key = `shared-${Date.now()}`;
    await service.createTrackRentalOrder(userA.id, product.id, key);
    await expect(
      service.createTrackRentalOrder(userB.id, product.id, key),
    ).rejects.toThrow(BadRequestException);
  });
});