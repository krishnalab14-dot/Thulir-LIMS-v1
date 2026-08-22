import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LookupItemsService } from './lookup-items.service';

@Controller('lookup-items')
export class LookupItemsController {
  constructor(private readonly service: LookupItemsService) {}

  /** GET /api/lookup-items?category=title&all=true — active (default) or all */
  @Get()
  list(@Query('category') category: string, @Query('all') all?: string) {
    if (!category) return [];
    return all === 'true' ? this.service.listAll(category) : this.service.list(category);
  }

  /** POST /api/lookup-items { category, value, sortOrder? } */
  @Post()
  create(@Body() body: { category: string; value: string; sortOrder?: number }) {
    return this.service.create(body.category, body.value, body.sortOrder);
  }

  /** PATCH /api/lookup-items/:id { value?, sortOrder?, active? } */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { value?: string; sortOrder?: number; active?: boolean },
  ) {
    if (body.active !== undefined) {
      return this.service.toggleActive(id, body.active);
    }
    return this.service.update(id, body);
  }
}
