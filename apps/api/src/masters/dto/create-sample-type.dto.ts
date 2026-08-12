import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSampleTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
