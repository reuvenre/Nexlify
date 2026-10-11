import { IsString, IsOptional, IsBoolean, IsIn, IsInt, Min, Max, ValidateIf, MaxLength } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['telegram'])
  platform?: string;

  @IsOptional()
  @IsString()
  bot_token?: string;

  @IsOptional()
  @IsString()
  channel_id?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  body_template_id?: string;

  @IsOptional()
  @IsString()
  footer_template_id?: string;

  @IsOptional()
  @IsString()
  facebook_page_id?: string;

  @IsOptional()
  @IsString()
  facebook_page_token?: string;

  /** Instagram Business account for this group; blank = the account's global one. */
  @IsOptional()
  @IsString()
  instagram_business_id?: string;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  bot_token?: string;

  @IsOptional()
  @IsString()
  channel_id?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  body_template_id?: string;

  @IsOptional()
  @IsString()
  footer_template_id?: string;

  @IsOptional()
  @IsString()
  facebook_page_id?: string;

  @IsOptional()
  @IsString()
  facebook_page_token?: string;

  @IsOptional()
  @IsString()
  instagram_business_id?: string;

  /** Opt-in: nudge this group's posts into its learned golden hours. */
  @IsOptional()
  @IsBoolean()
  smart_timing?: boolean;

  /** The group's core focus — empty clears it. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(400)
  core_focus?: string | null;

  // ── Per-group send queue (explicit null = inherit the user's global schedule) ──
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  schedule_enabled?: boolean | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(1440)
  schedule_interval_minutes?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(23)
  schedule_start_hour?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(24)
  schedule_end_hour?: number | null;
}
