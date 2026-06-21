import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Security headers
  app.use(helmet({ crossOriginResourcePolicy: false }));

  // CORS
  app.enableCors({
    origin: config.get<string>('corsOrigin')?.split(',') ?? '*',
    credentials: true,
  });

  // Global validation — strips unknown props, rejects extras, transforms types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Consistent error responses
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix('api');

  // Swagger / OpenAPI docs at /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Procurement Analyzer API')
    .setDescription('Compare supplier quotations, analyze costs, detect risks, and generate reports.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('port') ?? 4000;
  await app.listen(port, '0.0.0.0');
  logger.log(`API running on http://localhost:${port}/api`);
  logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
