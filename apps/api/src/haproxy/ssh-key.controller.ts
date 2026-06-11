import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SshKeysService } from './ssh-keys.service';

@ApiTags('ssh-key')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('ssh-key')
export class SshKeyController {
  constructor(private readonly svc: SshKeysService) {}

  /** Публичный ключ панели — положить в authorized_keys на SSH-нодах. Генерируется при первом запросе. */
  @Get()
  get() {
    return this.svc.getOrCreate();
  }
}
