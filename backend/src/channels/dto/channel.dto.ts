import { IsString, IsOptional, IsBoolean, IsIn, IsInt, Min, Max, ValidateIf } from 'class-validator';

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
