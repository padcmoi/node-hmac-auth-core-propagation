import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminModule } from "./admin/admin.module.js";
import { EchoModule } from "./echo/echo.module.js";
import { HmacAuthModule } from "./hmac-auth/hmac-auth.module.js";
import { HmacPropagationDataModule } from "./hmac-propagation-data/hmac-propagation-data.module.js";
import { HmacCredential, HmacCredentialTarget, HmacPropagationTarget } from "./hmac-propagation-data/entities/index.js";
import { HmacPropagatorModule } from "./hmac-propagator/hmac-propagator.module.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: "mariadb",
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [HmacCredential, HmacCredentialTarget, HmacPropagationTarget],
      synchronize: false,
      migrationsRun: false,
    }),
    HmacAuthModule,
    HmacPropagationDataModule,
    HmacPropagatorModule,
    AdminModule,
    EchoModule,
  ],
})
export class AppModule {}
