import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FrontendsService } from './frontends.service';

@ApiTags('haproxy:frontends')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('clusters/:clusterId/frontends')
export class FrontendsController {
  constructor(private readonly svc: FrontendsService) {}

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
      defaultBackend?: string | null;
      options?: Record<string, unknown>;
      timeouts?: Record<string, string>;
      logFormat?: string;
      rawExtra?: string;
    },
  ) {
    return this.svc.create(clusterId, body);
  }

  @Delete(':name')
  remove(@Param('clusterId') clusterId: string, @Param('name') name: string) {
    return this.svc.remove(clusterId, name);
  }
}
