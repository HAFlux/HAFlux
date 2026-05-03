import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { MapsService } from './maps.service';

@ApiTags('haproxy:maps')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('clusters/:clusterId/maps')
export class MapsController {
  constructor(private readonly svc: MapsService) {}

  @Get()
  list(@Param('clusterId') clusterId: string) {
    return this.svc.list(clusterId);
  }

  @Post()
  create(
    @Param('clusterId') clusterId: string,
    @Body()
    body: { name: string; description?: string; entries?: Array<{ key: string; value: string }> },
  ) {
    return this.svc.create(clusterId, body);
  }

  @Put(':name')
  update(
    @Param('clusterId') clusterId: string,
    @Param('name') name: string,
    @Body() body: { description?: string; entries?: Array<{ key: string; value: string }> },
  ) {
    return this.svc.update(clusterId, name, body);
  }

  @Delete(':name')
  remove(@Param('clusterId') clusterId: string, @Param('name') name: string) {
    return this.svc.remove(clusterId, name);
  }
}
