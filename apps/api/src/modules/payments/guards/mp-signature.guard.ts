import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Valida a assinatura HMAC enviada pelo Mercado Pago no header x-signature.
 *
 * Manifesto oficial:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Em NODE_ENV != production, é possível pular a validação definindo
 * MP_WEBHOOK_SKIP_VALIDATION=true (útil para ngrok + CLI local).
 */
@Injectable()
export class MpSignatureGuard implements CanActivate {
  private readonly logger = new Logger(MpSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();

    // Bypass explícito apenas fora de produção
    const skip =
      this.config.get<string>('MP_WEBHOOK_SKIP_VALIDATION') === 'true';
    if (skip && this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn('Validação de assinatura do MP ignorada (dev).');
      return true;
    }

    const secret = this.config.get<string>('MP_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('MP_WEBHOOK_SECRET não configurado.');
      throw new ForbiddenException();
    }

    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];

    // data.id pode vir no body, na query (?data.id=...) ou em params
    const dataId =
      req.body?.data?.id ??
      req.query?.['data.id'] ??
      req.params?.id;

    if (!xSignature || !xRequestId || !dataId) {
      this.logger.warn('Headers/IDs ausentes na notificação do MP.');
      throw new ForbiddenException();
    }

    // x-signature: "ts=1700000000,v1=abcdef..."
    const parts = Object.fromEntries(
      String(xSignature)
        .split(',')
        .map((p) => {
          const i = p.indexOf('=');
          return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
        }),
    );
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) throw new ForbiddenException();

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(v1, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn(`Assinatura inválida (data.id=${dataId}).`);
      throw new ForbiddenException();
    }

    // Deixa o payload normalizado disponível para o controller
    req.mpPayload = {
      topic: req.body?.type ?? req.body?.topic ?? req.query?.type,
      paymentId: String(dataId),
    };

    return true;
  }
}