import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NodesService } from './nodes.service';

@ApiTags('nodes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('clusters/:clusterId/nodes')
export class NodesController {
  constructor(private readonly svc: NodesService) {}

  @Get()
  list(@Param('clusterId') clusterId: string) {
    return this.svc.list(clusterId);
  }

  @Post()
  create(@Param('clusterId') clusterId: string, @Body() body: unknown) {
    return this.svc.create(clusterId, body);
  }

  @Patch(':nodeId')
  update(
    @Param('clusterId') clusterId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
  ) {
    return this.svc.update(clusterId, nodeId, body);
  }

  @Delete(':nodeId')
  @HttpCode(200)
  remove(@Param('clusterId') clusterId: string, @Param('nodeId') nodeId: string) {
    return this.svc.remove(clusterId, nodeId);
  }

  /** Проверить доступность ноды (SSH connect + haproxy -v / local validate). */
  @Post(':nodeId/test')
  @HttpCode(200)
  test(@Param('clusterId') clusterId: string, @Param('nodeId') nodeId: string) {
    return this.svc.test(clusterId, nodeId);
  }

  /** Сделать ноду PRIMARY (для ACTIVE_PASSIVE; трафик-failover требует VIP/keepalived). */
  @Post(':nodeId/promote')
  @HttpCode(200)
  promote(@Param('clusterId') clusterId: string, @Param('nodeId') nodeId: string) {
    return this.svc.promote(clusterId, nodeId);
  }
}
