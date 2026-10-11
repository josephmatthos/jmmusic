import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { MpSignatureGuard } from './guards/mp-signature.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('mercadopago')
  @HttpCode(200)
  @UseGuards(MpSignatureGuard)
  async mercadopago(
    @Body() body: any,
    @Query() query: any,
    @Req() req: any,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    const topic = req.mpPayload?.topic ?? body?.type ?? body?.topic;
    const paymentId = req.mpPayload?.paymentId ?? body?.data?.id ?? query?.['data.id'];

    // Sempre responde 200 rápido para o MP não retentar por timeout.
    // O processamento é feito de forma idempotente e tolerante a falhas.
    if (!topic || !paymentId) {
      return { ok: true, ignored: true };
    }

    if (topic !== 'payment' && topic !== 'payment.updated') {
      // Outros tópicos (merchant_order, plan, etc.) não nos interessam aqui.
      return { ok: true, ignored: true };
    }

    try {
      await this.payments.processPaymentNotification(String(paymentId));
    } catch (err) {
      // Loga mas NÃO devolve 5xx: senão o MP fica retentando em loop.
      // O job de reconciliação é que deve reprocessar falhas.
      // (Se preferir retry do MP, lance uma exceção 5xx aqui.)
    }

    return { ok: true };
  }
}