import { type LoginRequest, LoginRequestSchema, type LoginResponse } from '@haflux/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Returns access + refresh tokens.' })
  async login(@Body() body: unknown, @Req() req: { ip?: string }): Promise<LoginResponse> {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const dto: LoginRequest = parsed.data;
    const ip = req.ip ?? 'unknown';

    const retryAfter = await this.throttle.blockedFor(ip, dto.email);
    if (retryAfter !== null) {
      throw new HttpException(`Too many failed login attempts. Try again in ${retryAfter}s.`, 429);
    }

    try {
      const result = await this.auth.login(dto);
      await this.throttle.registerSuccess(ip, dto.email);
      return result;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        await this.throttle.registerFailure(ip, dto.email);
      }
      throw err;
    }
  }
}
