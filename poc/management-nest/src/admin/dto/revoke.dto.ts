import { ArrayMinSize, ArrayUnique, IsArray, IsString, MaxLength, MinLength } from "class-validator";

export class RevokeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  targets!: string[];
}

export class RevokeResponseDto {
  clientId!: string;
}
