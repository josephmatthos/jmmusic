import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadopagoService } from '../mercadopago/mercadopago.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService — construtor', () => {
  it('instancia com 4 dependências', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: MercadopagoService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
            getOrThrow: jest.fn(),
          },
        },
        {
          provide: EntitlementService,
          useValue: {
            invalidateUser: jest.fn(),
          },
        },
      ],
    }).compile();

    expect(mod.get(PaymentsService)).toBeDefined();
  });
});