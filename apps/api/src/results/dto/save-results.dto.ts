import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

export class SaveResultEntryDto {
  @IsString()
  @IsNotEmpty()
  orderTestId!: string;

  /**
   * The raw value to store, interpreted per the row's snapshottedResultType
   * (numeric string / one of the snapshotted options / free text). Empty
   * string = "not yet entered" → clears the result and reverts the row to
   * pending; it never advances status.
   */
  @IsString()
  resultValue!: string;

  /**
   * Optimistic-concurrency anchor (optional): the resultValue this client
   * last observed. The write is a compare-and-swap — it only lands if the
   * row still holds expectedValue. Omitted ⇒ treated as null, i.e. the
   * entry path: only writes a row that has no result yet. This is what makes
   * two simultaneous saves of the same pending row land exactly once (the
   * loser is reported as skipped, never silently overwritten) while still
   * allowing legitimate edits of already-entered rows.
   */
  @IsOptional()
  @IsString()
  expectedValue?: string;
}

export class SaveResultsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveResultEntryDto)
  entries!: SaveResultEntryDto[];
}
