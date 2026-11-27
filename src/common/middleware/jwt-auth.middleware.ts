import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class JwtAuthMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  use = (req: Request, res: Response, next: NextFunction) => {
    const token = (req as any).cookies?.access_token;
    if (token) {
      try {
        const payload = this.jwt.verify(token, {
          secret: this.config.get<string>('JWT_SECRET'),
        });
        (req as any).user = { username: payload.username, role: payload.role };
      } catch {
        // bad/expired token — leave req.user undefined
      }
    }
    next();
  };
}
