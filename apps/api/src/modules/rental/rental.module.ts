import { Module } from '@nestjs/common';
import { RentalService } from './rental.service';
import { RentalController } from './rental.controller';
import { RentalExpirationService } from './rental-expiration.service';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [EntitlementModule],
  controllers: [RentalController],
  providers: [RentalService, RentalExpirationService],
  exports: [RentalService],
})
export class RentalModule {}