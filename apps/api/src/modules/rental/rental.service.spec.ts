import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { RentalService } from './rental.service';

describe('RentalService — idempotência', () => {
  let service: RentalService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        RentalService,
        PrismaService,
        {
          provide: EntitlementService,
          useValue: {
            canPlay: jest.fn().mockResolvedValue({
              allowed: true,
              reason: 'test',
              source: 'admin',
            }),
            invalidateUser: jest.fn().mockResolvedValue(undefined),
            invalidateTrack: jest.fn().mockResolvedValue(undefined),
            invalidateAlbum: jest.fn().mockResolvedValue(undefined),
          },
        },
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
    const ts = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `test-${ts}@example.com`,
        name: 'Test User',
        passwordHash: 'x',
      },
    });
    const artist = await prisma.artist.create({
      data: { name: `Artist ${ts}`, slug: `artist-${ts}` },
    });
    const track = await prisma.track.create({
      data: {
        title: 'T',
        slug: `t-${ts}`,
        artistId: artist.id,
        status: 'PUBLISHED',
        streamKey: `streaming/${ts}/stream.mp3`,
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

    const key = `test-${ts}`;
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
    const ts = Date.now();
    const userA = await prisma.user.create({
      data: {
        email: `a-${ts}@example.com`,
        name: 'A',
        passwordHash: 'x',
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `b-${ts}@example.com`,
        name: 'B',
        passwordHash: 'x',
      },
    });
    const artist = await prisma.artist.create({
      data: { name: `Artist2 ${ts}`, slug: `artist2-${ts}` },
    });
    const track = await prisma.track.create({
      data: {
        title: 'T2',
        slug: `t2-${ts}`,
        artistId: artist.id,
        status: 'PUBLISHED',
        streamKey: `streaming/${ts}/stream.mp3`,
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

    const key = `shared-${ts}`;
    await service.createTrackRentalOrder(userA.id, product.id, key);
    await expect(
      service.createTrackRentalOrder(userB.id, product.id, key),
    ).rejects.toThrow(BadRequestException);
  });
});