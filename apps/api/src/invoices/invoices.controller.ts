import { Body, Controller, Param, Post } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post(':invoiceId/payments')
  addPayment(@Param('invoiceId') invoiceId: string, @Body() dto: CreatePaymentDto) {
    return this.invoices.addPayment(invoiceId, dto);
  }
}
