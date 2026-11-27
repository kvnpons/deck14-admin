import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import hbs from 'hbs';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import flash from 'connect-flash';
import { AppModule } from './app.module';
import { AuthExceptionFilter } from './common/filters/auth-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  const viewsDir = join(process.cwd(), 'views');
  const publicDir = join(process.cwd(), 'public');

  app.useStaticAssets(publicDir, { prefix: '/static/' });
  app.useStaticAssets(join(__dirname, 'assets'), { prefix: '/assets/' });
  app.setBaseViewsDir(viewsDir);
  // hbs converts dashes to underscores by default; keep names as-is so {{> client-form}} resolves
  hbs.registerPartials(join(viewsDir, 'partials'), { rename: (name: string) => name } as any);
  app.setViewEngine('hbs');

  hbs.registerHelper('formatDate', (d: Date | string) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  });
  hbs.registerHelper('formatDateTime', (d: Date | string) => {
    if (!d) return '';
    return new Date(d).toLocaleString();
  });
  hbs.registerHelper('formatMoney', (n: any) => {
    const v = Number(n ?? 0);
    return v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
  hbs.registerHelper('isoDate', (d: Date | string) => {
    if (!d) return '';
    return new Date(d).toISOString().slice(0, 10);
  });
  hbs.registerHelper('isNegative', (n: any) => Number(n) < 0);
  hbs.registerHelper('eq', (a: any, b: any) => a === b);
  hbs.registerHelper('signed', (n: any) => {
    const v = Number(n ?? 0);
    return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
  });
  hbs.registerHelper('gt', (a: any, b: any) => Number(a) > Number(b));
  hbs.registerHelper('padSerial', (n: any) => String(n).padStart(6, '0'));
  hbs.registerHelper('json', (ctx: any) => JSON.stringify(ctx));

  app.use(cookieParser());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'dev-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
    }),
  );
  app.use(flash());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AuthExceptionFilter(app.get(Reflector)));

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Deck14 Admin listening on http://0.0.0.0:${port}`);
}

bootstrap();
