import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createClient } from "redis";
import { initializeHmacHttpAuth, initializeHmacMessageAuth } from "@naskot/node-hmac-auth-core";

@Injectable()
export class HmacAuthService implements OnModuleInit, OnModuleDestroy {
  public redis!: ReturnType<typeof createClient>;
  public http!: ReturnType<typeof initializeHmacHttpAuth>;
  public message!: ReturnType<typeof initializeHmacMessageAuth>;

  async onModuleInit() {
    this.redis = createClient({ url: process.env.REDIS_URL });
    await this.redis.connect();

    this.http = initializeHmacHttpAuth({
      redis: this.redis as never,
      namespace: "hmac:http",
      secretToken: process.env.HMAC_SECRET_TOKEN,
    });

    this.message = initializeHmacMessageAuth({
      redis: this.redis as never,
      namespace: "hmac:message",
      secretToken: process.env.HMAC_SECRET_TOKEN,
    });

    console.info("[mgmt-nest] hmac-auth ready, namespaces=hmac:http + hmac:message");
  }

  async onModuleDestroy() {
    await this.redis?.disconnect();
  }
}
