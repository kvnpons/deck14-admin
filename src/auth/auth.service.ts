import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  signIn(username: string, password: string): string | null {
    const adminUsername = this.config.get<string>('ADMIN_USERNAME');
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD');

    if (!adminUsername || !adminPassword) return null;
    if (username !== adminUsername || password !== adminPassword) return null;

    return this.jwt.sign({ username, role: 'admin' });
  }
}
