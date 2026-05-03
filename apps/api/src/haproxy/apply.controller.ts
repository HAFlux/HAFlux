import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ApplyService } from './apply.service';

@ApiTags('haproxy:apply')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('clusters/:clusterId')
export class ApplyController {
  constructor(private readonly svc: ApplyService) {}

  @Post('apply')
  apply(
    @Param('clusterId') clusterId: string,
    @Body() body: { message?: string; dryRun?: boolean },
  ) {
    return this.svc.applyCluster(clusterId, {
      message: body.message ?? 'Apply via UI',
      dryRun: body.dryRun ?? false,
    });
  }

  @Post('validate')
  validate(@Param('clusterId') clusterId: string) {
    return this.svc.applyCluster(clusterId, {
      message: 'Validate only',
      dryRun: true,
    });
  }
}
