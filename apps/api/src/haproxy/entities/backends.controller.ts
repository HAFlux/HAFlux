import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BackendsService } from './backends.service';

@ApiTags('haproxy:backends')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('clusters/:clusterId/backends')
export class BackendsController {
  constructor(private readonly svc: BackendsService) {}

  @Get()
  list(@Param('clusterId') clusterId: string) {
    return this.svc.list(clusterId);
  }

  @Post()
  create(
    @Param('clusterId') clusterId: string,
    @Body()
    body: {
      name: string;
      mode: 'http' | 'tcp';
      balance?:
        | 'roundrobin'
        | 'static_rr'
        | 'leastconn'
        | 'source'
        | 'uri'
        | 'url_param'
        | 'hdr'
        | 'random';
      servers?: Array<{
        name: string;
        address: string;
        port: number;
        weight?: number;
        check?: boolean;
      }>;
      options?: Record<string, unknown>;
      timeouts?: Record<string, string>;
      httpCheck?: { uri?: string; method?: string; expectStatus?: string };
    },
  ) {
    return this.svc.create(clusterId, body);
  }

  @Delete(':name')
  remove(@Param('clusterId') clusterId: string, @Param('name') name: string) {
    return this.svc.remove(clusterId, name);
  }
}
