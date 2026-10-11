import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './modules/payments/payments.service';

describe('PaymentsService webhook validation', () => {
  const makeConfig = (overrides: Partial<Record<string, string | undefined>> = {}) => ({
    get: (key: string) => {
      const value = overrides[key];
      if (value !== undefined) return value;
      return undefined;
    },
  });

  it('accepts a valid Mercadopago signature', () => {
    const secret = 'super-secret-webhook';
    const ts = '1710000000';
    const manifest = 'id:evt_123;request-id:req-42;ts:1710000000;';
    const xSignature = `v1=${createHmac('sha256', secret)
      .update(manifest)
      .digest('hex')},ts=${ts}`;

    const service = new PaymentsService(
      {} as any,
      {} as any,
      makeConfig({
        NODE_ENV: 'production',
        MERCADOPAGO_WEBHOOK_SECRET: secret,
      }) as any,
    );

    expect(() =>
      (service as any).verifySignature({
        xSignature,
        xRequestId: 'req-42',
        manifest,
      }),
    ).not.toThrow();
  });

  it('rejects a mismatched Mercadopago signature', () => {
    const service = new PaymentsService(
      {} as any,
      {} as any,
      makeConfig({
        NODE_ENV: 'production',
        MERCADOPAGO_WEBHOOK_SECRET: 'right-secret',
      }) as any,
    );

    expect(() =>
      (service as any).verifySignature({
        xSignature: 'v1=deadbeef,ts=1710000000',
        xRequestId: 'req-42',
        manifest: 'id:evt_123;request-id:req-42;ts:1710000000;',
      }),
    ).toThrow(BadRequestException);
  });

  it('fails closed in production when the webhook secret is missing', () => {
    const service = new PaymentsService(
      {} as any,
      {} as any,
      makeConfig({
        NODE_ENV: 'production',
        MERCADOPAGO_WEBHOOK_SECRET: undefined,
      }) as any,
    );

    expect(() => (service as any).verifySignature({})).toThrow(
      'MERCADOPAGO_WEBHOOK_SECRET é obrigatório em produção',
    );
  });
});
