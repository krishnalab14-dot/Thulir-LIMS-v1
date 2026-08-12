import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });

  // DTOs are class-validator based. Unknown body properties (e.g. a tampered
  // frontend sending prices) are rejected outright via forbidNonWhitelisted.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Deliberately NOT `PORT`: Freebuff injects PORT for the web dev server and
  // Vite binds it, so reading the same variable here made the two dev servers
  // fight over one port (Nest crashed with EADDRINUSE, the /api proxy 500'd).
  // The API owns API_PORT (default 3000 — what the Vite proxy targets).
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Thulir API listening on http://0.0.0.0:${port}`, 'Bootstrap');
}

bootstrap();
