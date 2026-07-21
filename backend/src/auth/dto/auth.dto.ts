import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AuthDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  /** Display name (registration only; ignored on login). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
