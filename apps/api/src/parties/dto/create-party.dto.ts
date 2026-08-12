import { PartyType } from '@prisma/client';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePartyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsIn(Object.values(PartyType))
  type!: PartyType;
}
