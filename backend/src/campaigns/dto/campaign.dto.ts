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

  /** Platforms this campaign publishes to. Empty/omitted = the account's global toggles. */
  @IsOptional()
  @IsArray()
  @IsIn(['telegram', 'facebook', 'instagram', 'pinterest', 'whatsapp'], { each: true })
  target_platforms?: string[];

  /** Price-currency override for this campaign. Omitted = the account's currency. */
  @IsOptional()
  @IsIn(['USD_ILS', 'USD_USD', 'USD_EUR', 'USD_GBP'])
  currency_pair?: string;

  /** Per-campaign send window (hours in window_tz). Omitted = group/account window. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  window_start_hour?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  window_end_hour?: number;

  /** IANA timezone for the window hours — limited to a known set so a typo can't
   *  silently break scheduling. */
  @IsOptional()
  @IsIn(['Asia/Jerusalem', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London'])
  window_tz?: string;

  @IsOptional()
  @IsNumber()
  markup_percent?: number;

  @IsOptional()
  @IsString()
  post_template?: string;
}
