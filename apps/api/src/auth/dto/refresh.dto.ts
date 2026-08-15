import { IsNotEmpty, IsString } from 'class-validator';

/** A raw refresh token (exchanged for a new access token / rotated). */
export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
