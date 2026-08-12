import { RejectionReason } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class RejectSampleDto {
  @IsEnum(RejectionReason)
  reason!: RejectionReason;

  /** Free-text note — REQUIRED server-side when reason = other (not just a frontend rule). */
  @ValidateIf((o: RejectSampleDto) => o.reason === RejectionReason.other)
  @IsString()
  @IsNotEmpty({ message: 'A note is required when the rejection reason is "other"' })
  @MaxLength(500)
  note?: string;
}
