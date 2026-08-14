import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * PUT /api/orders/:id/approve — batch of OrderTest ids to approve at once
 * (supports both "Approve & Sign" for one row and "Approve All Visible").
 */
export class ApproveOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderTestIds!: string[];
}

/**
 * PUT /api/orders/:id/reject-back-to-verify — one row at a time, with a
 * required free-text reason. Reuses OrderTest.verifyRejectedNote (a
 * pathologist-initiated reject-back has the same outcome as a technician-
 * initiated one: the test needs correction and re-entry), and the target
 * state is the SAME `entered` state Verify's own reject-back uses — never a
 * fifth quasi-state.
 */
export class RejectBackToVerifyDto {
  @IsString()
  @IsNotEmpty()
  orderTestId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
