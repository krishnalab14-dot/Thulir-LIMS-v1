import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { BillGroupsService } from './bill-groups.service';

@Controller('bill-groups')
export class BillGroupsController {
  constructor(private readonly billGroups: BillGroupsService) {}

  /** POST /api/bill-groups — create a new empty BillGroup. */
  @Post()
  create() {
    return this.billGroups.create();
  }

  /** GET /api/bill-groups/:id — fetch a BillGroup with its linked orders. */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.billGroups.findOne(id);
  }

  /** PATCH /api/bill-groups/:id/orders/:orderId — link an order to the group. */
  @Patch(':id/orders/:orderId')
  linkOrder(@Param('id') id: string, @Param('orderId') orderId: string) {
    return this.billGroups.linkOrder(id, orderId);
  }

  /** PATCH /api/bill-groups/:id/orders/:orderId/unlink — unlink an order. */
  @Patch(':id/orders/:orderId/unlink')
  unlinkOrder(@Param('id') id: string, @Param('orderId') orderId: string) {
    return this.billGroups.unlinkOrder(id, orderId);
  }
}
