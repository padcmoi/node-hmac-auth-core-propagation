import { ApiProperty } from "@nestjs/swagger";
import { HashResponseDto } from "./hash.dto.js";

ApiProperty({
  type: String,
  description: "hashClientSecret(plain, HMAC_SECRET_TOKEN). Used to verify locally what hash would be stored.",
  example: "dc7ba51046ec7c58d26c3f46c38533df19fc0ad824d4424b61c35ddd43717b43",
})(HashResponseDto.prototype, "hash");
