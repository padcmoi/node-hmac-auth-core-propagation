import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  // bodyParser: false so empty GET requests keep req.body undefined.
  // The HMAC verifier hashes the body string; "{}" (Nest's default for empty body)
  // would mismatch the client's empty signing payload and yield BAD_SIGNATURE.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));

  const swaggerCfg = new DocumentBuilder()
    .setTitle("hmac-propagation POC | consumer-nest")
    .setDescription(
      "Receive-only peer. The HMAC middleware verifies inbound signed requests against the local credential store kept in sync by the propagation lib."
    )
    .setVersion("1.0.0")
    .addTag("echo", "HMAC-verified business route")
    .addTag("health", "liveness probe (unauthenticated)")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "docs-json" });

  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port, "0.0.0.0");
  console.info(`[c-nest] listening on :${port}, swagger=/docs, mode=receive-only`);
}

bootstrap().catch((err) => {
  console.error("[c-nest] FATAL", err);
  process.exit(1);
});
