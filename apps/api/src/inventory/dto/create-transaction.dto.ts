import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { InventoryDirection } from '@prisma/client';

export class CreateTransactionDto {
  @IsNotEmpty()
  @IsString()
  itemId!: string;

  @IsNotEmpty()
  @IsEnum(InventoryDirection)
  direction!: InventoryDirection;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
