import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthExceptionFilter.name);

  constructor(private readonly reflector: Reflector) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // Unauthenticated → bounce to login (or 401 JSON if it's an API call)
    if (exception instanceof UnauthorizedException) {
      const wantsJson = (req.headers.accept || '').includes('application/json');
      if (wantsJson) {
        res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Unauthorized' });
        return;
      }
      (req as any).flash?.('error', 'Please sign in to continue.');
      res.redirect('/auth/login');
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.NOT_FOUND) {
        res.status(404).render('errors/404', { title: 'Not found' });
        return;
      }
      const body = exception.getResponse() as any;
      const message = typeof body === 'string' ? body : body?.message || exception.message;
      res.status(status).render('errors/error', { title: 'Error', status, message });
      return;
    }

    this.logger.error(exception);
    res.status(500).render('errors/error', {
      title: 'Server error',
      status: 500,
      message: 'Something went wrong.',
    });
  }
}
