import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * PUT /api/orders/:id/verify — batch of OrderTest ids to verify at once
 * (supports both "verify this one row" and "Verify All Visible").
 */
export class VerifyOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderTestIds!: string[];
}

/**
 * PUT /api/orders/:id/reject-back-to-entry — one row at a time, with a
 * required free-text reason (matches the "Typing error in Sugar value"
 * reference UX). The reason is stored on OrderTest.verifyRejectedNote and
 * cleared on the next successful verify.
 */
export class RejectBackDto {
  @IsString()
  @IsNotEmpty()
  orderTestId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
