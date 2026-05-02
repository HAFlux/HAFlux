import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AppException, ErrorCode } from '../common/errors';
import { zodToAppException } from '../common/zod-to-error';
import type { JwtPayload } from './jwt.strategy';

const RESERVED_TLDS = new Set(['local', 'localhost', 'test', 'invalid', 'example']);

const UpdateMeSchema = z
  .object({
    email: z
      .string()
      .email('must be a valid address')
      .refine((v) => {
        const tld = v.split('@')[1]?.split('.').pop()?.toLowerCase();
        return tld !== undefined && tld.length >= 2 && !RESERVED_TLDS.has(tld);
      }, { message: '.local / .test / .localhost are reserved' })
      .optional(),
    displayName: z.string().min(1).max(100).optional(),
    /** Текущий пароль — обязателен ВСЕГДА для подтверждения личности. */
    currentPassword: z.string().min(1, 'currentPassword is required'),
    newPassword: z.string().min(8, 'newPassword must be ≥ 8 chars').max(256).optional(),
  })
  .refine((d) => d.email !== undefined || d.newPassword !== undefined || d.displayName !== undefined, {
    message: 'nothing to update — provide email, displayName or newPassword',
  });

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async me(@Req() req: { user: JwtPayload }) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new AppException(ErrorCode.UNAUTHORIZED, 'User not found', 401);
    return user;
  }

  @Patch()
  async update(@Req() req: { user: JwtPayload }, @Body() body: unknown) {
    const parsed = UpdateMeSchema.safeParse(body);
    if (!parsed.success) {
      throw zodToAppException(parsed.error, {
        email: ErrorCode.EMAIL_INVALID_FORMAT,
        currentPassword: ErrorCode.UNAUTHORIZED,
      });
    }
    const { email, displayName, currentPassword, newPassword } = parsed.data;

    const user = await this.prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user || !user.passwordHash) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'User not found', 401);
    }

    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Current password is incorrect',
        401,
      );
    }

    // Проверка на занятый email
    if (email && email.toLowerCase() !== user.email) {
      const taken = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (taken)
        throw new AppException(
          ErrorCode.ALREADY_EXISTS,
          `Email ${email} is already in use`,
          409,
        );
    }

    const data: {
      email?: string;
      displayName?: string;
      passwordHash?: string;
    } = {};
    if (email) data.email = email.toLowerCase();
    if (displayName !== undefined) data.displayName = displayName;
    if (newPassword) data.passwordHash = await this.auth.hashPassword(newPassword);

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
      select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });

    return { ...updated, passwordChanged: !!newPassword };
  }
}
