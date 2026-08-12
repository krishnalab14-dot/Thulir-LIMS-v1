import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
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
  constructor(private readonly orders: OrdersService) {}

  @Post()
  createOrder(@Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto);
  }

  @Get()
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.listOrders(query.limit ?? 50);
  }
}
