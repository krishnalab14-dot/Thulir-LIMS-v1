import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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

  // Stage 2.1 per-test override: true ⇒ this test always gets its own
  // dedicated Sample/tube, even when another test on the same order shares
  // its sample type. Defaults false (shares a tube, as in Stage 2).
  @IsOptional()
  @IsBoolean()
  requiresDedicatedSample?: boolean;
}
