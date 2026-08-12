import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateTestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  testCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  testName!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  currentPrice!: number;

  @IsOptional()
  @IsString()
  requiredSampleTypeId?: string;
}
