import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateTargetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  targetAmqpQueue!: string;

  @IsString()
  @MinLength(1)
  propagationSecret!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class TargetMutationResponseDto {
  op!: "target.create" | "target.update" | "target.delete";
  targetAmqpQueue!: string;
}
