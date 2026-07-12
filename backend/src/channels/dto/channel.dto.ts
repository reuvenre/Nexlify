import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator';

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
}
