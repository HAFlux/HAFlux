import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { ApplyController } from './apply.controller';
import { ApplyService } from './apply.service';
import { BackendsController } from './entities/backends.controller';
import { BackendsService } from './entities/backends.service';
import { FrontendsController } from './entities/frontends.controller';
import { FrontendsService } from './entities/frontends.service';
import { MapsController } from './modules/maps.controller';
import { MapsService } from './modules/maps.service';
import { NodesHealthService } from './nodes-health.service';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { CfgRenderer } from './renderers/cfg.renderer';
import { SshKeyController } from './ssh-key.controller';
import { SshKeysService } from './ssh-keys.service';
import { TransportFactory } from './transports/transport.factory';

/**
 * Главный модуль управления HAProxy.
 *
 * Сюда же будут добавляться сервисы для остальных сущностей haproxy.cfg
 * (listen, peers, resolvers, userlists, http-errors, rings, caches) и модулей
 * (acl-lists, errorfiles, lua-scripts, spoe-agents) — по мере роста UI.
 */
@Module({
  imports: [CertificatesModule],
  controllers: [
    ApplyController,
    FrontendsController,
    BackendsController,
    MapsController,
    NodesController,
    SshKeyController,
  ],
  providers: [
    CfgRenderer,
    TransportFactory,
    ApplyService,
    FrontendsService,
    BackendsService,
    MapsService,
    SshKeysService,
    NodesService,
    NodesHealthService,
  ],
  exports: [CfgRenderer, ApplyService, TransportFactory, SshKeysService, NodesService],
})
export class HaproxyModule {}
