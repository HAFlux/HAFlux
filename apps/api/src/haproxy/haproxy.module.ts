import { Module } from '@nestjs/common';
import { CfgRenderer } from './renderers/cfg.renderer';
import { TransportFactory } from './transports/transport.factory';
import { ApplyService } from './apply.service';
import { ApplyController } from './apply.controller';
import { FrontendsController } from './entities/frontends.controller';
import { FrontendsService } from './entities/frontends.service';
import { BackendsController } from './entities/backends.controller';
import { BackendsService } from './entities/backends.service';
import { MapsController } from './modules/maps.controller';
import { MapsService } from './modules/maps.service';

/**
 * Главный модуль управления HAProxy.
 *
 * Сюда же будут добавляться сервисы для остальных сущностей haproxy.cfg
 * (listen, peers, resolvers, userlists, http-errors, rings, caches) и модулей
 * (acl-lists, errorfiles, lua-scripts, spoe-agents) — по мере роста UI.
 */
@Module({
  controllers: [
    ApplyController,
    FrontendsController,
    BackendsController,
    MapsController,
  ],
  providers: [
    CfgRenderer,
    TransportFactory,
    ApplyService,
    FrontendsService,
    BackendsService,
    MapsService,
  ],
  exports: [CfgRenderer, ApplyService],
})
export class HaproxyModule {}
