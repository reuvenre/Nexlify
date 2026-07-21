import { IsString, IsArray, IsOptional, IsNumber, IsIn, Min, Max } from 'class-validator';

export class CampaignDto {
  @IsString()
  name: string;

  /** 'aliexpress' (keyword search) or 'flylink' (rotate linked supplier catalog). */
  @IsOptional()
  @IsIn(['aliexpress', 'flylink', 'amazon'])
  source?: string;

  // Optional: a FLYLINK campaign has no keywords. The per-source requirement (AliExpress
  // needs keywords, FLYLINK needs target groups) is enforced in the runner, which fails
  // loudly with a Hebrew message rather than a generic 400.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  /** FLYLINK only: target group channel_ids the campaign publishes to. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  target_channels?: string[];

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_discount?: number;

  /** Minimum star rating (0–5). Enforced client-side against evaluate_rate. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  min_rating?: number;

  @IsString()
  schedule_cron: string;

  @IsNumber()
  @Min(1)
  posts_per_run: number;

  @IsOptional()
  @IsIn(['he', 'en', 'ar'])
  language?: string;

  @IsOptional()
  @IsNumber()
  markup_percent?: number;

  @IsOptional()
  @IsString()
  post_template?: string;
}
