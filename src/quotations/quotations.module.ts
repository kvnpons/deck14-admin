import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [InvoicesModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
})
export class QuotationsModule {}
