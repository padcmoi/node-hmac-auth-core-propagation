import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));

  const swaggerCfg = new DocumentBuilder()
    .setTitle("hmac-propagation POC | management-nest")
    .setDescription(
      "Authority peer that drives `propagator.ensure / rotate / revoke / sync` against its MariaDB schema `nest_db` and propagates events to the rest of the mesh over RabbitMQ."
    )
    .setVersion("1.0.0")
    .addTag("admin", "ensure / rotate / revoke / sync / state / debug helpers")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "docs-json" });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
  console.info(`[mgmt-nest] listening on :${port}, swagger=/docs`);
}

bootstrap().catch((err) => {
  console.error("[mgmt-nest] FATAL", err);
  process.exit(1);
});
