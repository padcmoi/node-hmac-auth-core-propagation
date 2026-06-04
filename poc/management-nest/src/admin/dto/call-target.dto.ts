import { IsString, IsUrl, MinLength } from "class-validator";

export class CallTargetDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  target!: string;

  @IsString()
  @MinLength(1)
  clientId!: string;

  @IsString()
  @MinLength(1)
  secret!: string;
}

export class CallTargetResponseDto {
  status!: number;
  body!: string;
}
