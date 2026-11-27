import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class ViewLocalsMiddleware implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction) => {
    const r: any = req;
    res.locals.user = r.user || null;
    res.locals.flashSuccess = typeof r.flash === 'function' ? r.flash('success') : [];
    res.locals.flashError = typeof r.flash === 'function' ? r.flash('error') : [];
    res.locals.currentPath = req.path;
    next();
  };
}
