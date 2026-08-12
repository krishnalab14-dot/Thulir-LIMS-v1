import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ResultsService } from '../results/results.service';
import { SaveResultsDto } from '../results/dto/save-results.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

export class ListOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly results: ResultsService,
  ) {}

  @Post()
  createOrder(@Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto);
  }

  @Get()
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.listOrders(query.limit ?? 50);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.orders.getOrderDetail(id);
  }

  // --- Stage 3: Result Entry ---

  @Get(':id/results')
  getResults(@Param('id') id: string) {
    return this.results.getResults(id);
  }

  @Put(':id/results')
  saveResults(@Param('id') id: string, @Body() dto: SaveResultsDto) {
    return this.results.saveResults(id, dto);
  }
}
