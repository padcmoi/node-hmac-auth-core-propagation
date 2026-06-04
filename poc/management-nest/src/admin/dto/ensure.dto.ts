import { ArrayMinSize, ArrayUnique, IsArray, IsString, MaxLength, MinLength } from "class-validator";

export class EnsureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  clientId!: string;

  @IsString()
  @MinLength(1)
  secret!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  targets!: string[];
}

export class EnsureResponseDto {
  clientId!: string;
  op!: "credential.create" | "credential.update";
}
