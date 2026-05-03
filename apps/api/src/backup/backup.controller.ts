import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { BackupService } from './backup.service';

interface ReplyLike {
  header(name: string, value: string): ReplyLike;
  send(payload: unknown): unknown;
}

@ApiTags('backup')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('backup')
export class BackupController {
  constructor(private readonly svc: BackupService) {}

  @Get()
  async download(@Res() reply: ReplyLike) {
    const payload = await this.svc.exportAll();
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="hpm-backup-${stamp}.json"`)
      .send(JSON.stringify(payload));
  }

  @Post('restore')
  restore(@Body() body: unknown) {
    return this.svc.importAll(body as never);
  }
}
