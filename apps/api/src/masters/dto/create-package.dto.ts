import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class CreatePackageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  packageName!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  packagePrice!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  testIds!: string[];
}
