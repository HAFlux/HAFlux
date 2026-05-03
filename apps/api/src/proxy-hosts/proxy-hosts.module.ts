import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { ProxyHostsHealthService } from './health.service';
import { HaproxyLogsService } from './logs.service';
import { ProxyHostsController } from './proxy-hosts.controller';
import { ProxyHostsService } from './proxy-hosts.service';
import { ProxyHostsRenderApplyService } from './render-apply.service';

@Module({
  imports: [
    CertificatesModule, // CryptoService для расшифровки cert.pem
  ],
  controllers: [ProxyHostsController],
  providers: [
    ProxyHostsService,
    ProxyHostsRenderApplyService,
    ProxyHostsHealthService,
    HaproxyLogsService,
  ],
  exports: [
    ProxyHostsService,
    ProxyHostsRenderApplyService,
    ProxyHostsHealthService,
    HaproxyLogsService,
  ],
})
export class ProxyHostsModule {}
