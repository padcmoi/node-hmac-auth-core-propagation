import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HmacCredential, HmacCredentialTarget, HmacPropagationTarget } from "./entities/index.js";

// Pure data container: declares the 3 propagation entities and re-exports
// TypeOrmModule so any module that imports this one can inject the repos.
@Module({
  imports: [TypeOrmModule.forFeature([HmacCredential, HmacCredentialTarget, HmacPropagationTarget])],
  exports: [TypeOrmModule],
})
export class HmacPropagationDataModule {}
