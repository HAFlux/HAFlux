import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { LoginRequestSchema, type LoginRequest, type LoginResponse } from '@hapilot/contracts';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Returns access + refresh tokens.' })
  async login(@Body() body: unknown): Promise<LoginResponse> {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const dto: LoginRequest = parsed.data;
    return this.auth.login(dto);
  }
}
