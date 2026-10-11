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
    @Headers('x-signature') _xSignature?: string,
    @Headers('x-request-id') _xRequestId?: string,
  ) {
    const topic = req.mpPayload?.topic ?? body?.type ?? body?.topic;
    const paymentId =
      req.mpPayload?.paymentId ?? body?.data?.id ?? query?.['data.id'];

    if (!topic || !paymentId) {
      return { ok: true, ignored: true };
    }

    if (topic !== 'payment' && topic !== 'payment.updated') {
      return { ok: true, ignored: true };
    }

    try {
      await this.payments.processPaymentNotification(String(paymentId));
    } catch (err) {
      // Responde 200 mesmo em falha: o MP retenta em loop se devolvermos 5xx.
      // O job de reconciliação (se existir) reprocessa.
    }

    return { ok: true };
  }
}