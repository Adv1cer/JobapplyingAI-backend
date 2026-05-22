import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // The '!' tells TypeScript that JWT_SECRET is guaranteed to be a string
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: { id: string; email: string }) {
    // Standard JWT payloads use 'sub' (subject), matching it to your findById
    const user = await this.usersService.findById(payload.id);
    
    if (!user) {
      throw new UnauthorizedException();
    }
    
    return user;
  }
}