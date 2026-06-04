import { IsString, MaxLength, MinLength } from "class-validator";

export class RotateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  clientId!: string;

  @IsString()
  @MinLength(1)
  secret!: string;
}

export class RotateResponseDto {
  clientId!: string;
}
