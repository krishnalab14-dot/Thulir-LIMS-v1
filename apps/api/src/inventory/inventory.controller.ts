import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';

/**
 * Inventory / Reagent Stock Tracking (Stage 10).
 * Ledger-based stock — every movement is an append-only row.
 * Current stock is always computed, never a mutable counter.
 */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------

  @Get('suppliers')
  listSuppliers() {
    return this.inventoryService.listSuppliers();
  }

  @Post('suppliers')
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.inventoryService.createSupplier(dto);
  }

  @Patch('suppliers/:id')
  updateSupplier(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.inventoryService.updateSupplier(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  @Get('items')
  listItems() {
    return this.inventoryService.listItems();
  }

  @Get('items/:id')
  getItem(@Param('id') id: string) {
    return this.inventoryService.getItem(id);
  }

  @Get('items/:id/stock')
  getStockDetail(@Param('id') id: string) {
    return this.inventoryService.getStockDetail(id);
  }

  @Post('items')
  createItem(@Body() dto: CreateItemDto) {
    return this.inventoryService.createItem(dto);
  }

  @Patch('items/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.inventoryService.updateItem(id, dto);
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  @Post('transactions')
  recordTransaction(@Body() dto: CreateTransactionDto) {
    return this.inventoryService.recordTransaction(dto);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  @Get('low-stock')
  getLowStock() {
    return this.inventoryService.getLowStock();
  }

  @Get('expiring')
  getExpiring(@Query('days') days?: string) {
    return this.inventoryService.getExpiring(days ? parseInt(days, 10) : 30);
  }

  // ---------------------------------------------------------------------------
  // Alerts (inventory-level alerts for the bell icon / inbox)
  // ---------------------------------------------------------------------------

  @Get('alerts')
  listAlerts() {
    return this.inventoryService.listAlerts();
  }

  @Get('alerts/count')
  alertCount() {
    return this.inventoryService.alertCount().then((count) => ({ count }));
  }
}
