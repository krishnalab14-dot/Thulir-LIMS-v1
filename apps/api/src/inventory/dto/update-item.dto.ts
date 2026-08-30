import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderThreshold?: number;

  @IsOptional()
  @IsString()
  preferredSupplierId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
