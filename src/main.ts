import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = new Logger('Bootstrap');

  // ── Global Pipes ────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Strip unknown fields
      forbidNonWhitelisted: true, // Throw on unknown fields
      transform: true,           // Auto-transform payloads to DTO classes
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global Filters ──────────────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Global Interceptors ─────────────────────────────────────────────────────
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Swagger ─────────────────────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('🏘️ Gatehouse API')
    .setDescription(
      'Estate management platform — Auth & Onboarding workflows powered by Nomba payments.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Auth', 'Manager registration, login and logout')
    .addTag('Onboarding', '4-step estate onboarding workflow')
    .addTag('Health', 'Application health checks')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
    },
    customSiteTitle: 'Gatehouse API Docs',
  });

  // ── Start ────────────────────────────────────────────────────────────────────
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`🚀 Gatehouse API running on: http://localhost:${port}`);
  logger.log(`📚 Swagger docs available at: http://localhost:${port}/api/docs`);
  logger.log(`❤️  Health check: http://localhost:${port}/health`);
}

bootstrap();
