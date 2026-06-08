import { IsOptional, IsString } from 'class-validator';

export class ReviewRecommendationDto {
  @IsOptional()
  @IsString()
  note?: string;
}
