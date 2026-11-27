import { Body, Controller, Get, Post, Render, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('login')
  @Render('auth/login')
  loginPage() {
    return { title: 'Sign in' };
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res() res: Response) {
    const token = this.auth.signIn(dto.username, dto.password);
    if (!token) {
      (req as any).flash('error', 'Invalid username or password.');
      return res.redirect('/auth/login');
    }
    res.cookie('access_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
    (req as any).flash('success', 'Welcome back!');
    return res.redirect('/');
  }

  // POST only: a GET logout can be triggered by any page (img tag, link prefetch).
  @Public()
  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    res.clearCookie('access_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    (req as any).flash('success', 'You have been signed out.');
    return res.redirect('/auth/login');
  }
}
