import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { WebhooksController } from './webhooks.controller';
import { MpSignatureGuard } from './guards/mp-signature.guard';
import { MercadopagoModule } from '../mercadopago/mercadopago.module';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [ConfigModule, MercadopagoModule, EntitlementModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, MpSignatureGuard],
  exports: [PaymentsService],
})
export class PaymentsModule {}