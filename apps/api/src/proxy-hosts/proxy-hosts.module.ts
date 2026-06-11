import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { HaproxyModule } from '../haproxy/haproxy.module';
import { GeoListsService } from './geo-lists.service';
import { ProxyHostsHealthService } from './health.service';
import { HaproxyLogsService } from './logs.service';
import { ProxyHostsController } from './proxy-hosts.controller';
import { ProxyHostsService } from './proxy-hosts.service';
import { ProxyHostsRenderApplyService } from './render-apply.service';

@Module({
  imports: [
    CertificatesModule, // CryptoService для расшифровки cert.pem
    HaproxyModule, // TransportFactory для деплоя на SSH-ноды
  ],
  controllers: [ProxyHostsController],
  providers: [
    ProxyHostsService,
    ProxyHostsRenderApplyService,
    ProxyHostsHealthService,
    HaproxyLogsService,
    GeoListsService,
  ],
  exports: [
    ProxyHostsService,
    ProxyHostsRenderApplyService,
    ProxyHostsHealthService,
    HaproxyLogsService,
  ],
})
export class ProxyHostsModule {}
