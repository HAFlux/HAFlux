import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCode } from '../common/errors';
import { zodToAppException } from '../common/zod-to-error';
import type { ProxyHostsHealthService } from './health.service';
import type { HaproxyLogsService } from './logs.service';
import type { ProxyHostsService } from './proxy-hosts.service';

const DomainSchema = z
  .string()
  .min(1, 'domain is required')
  .regex(/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, {
    message: 'must be a valid hostname (FQDN), wildcard *. allowed',
  });

const ForwardHostSchema = z
  .string()
  .min(1, 'forwardHost is required')
  .regex(/^([a-z0-9_-]+(\.[a-z0-9_-]+)+|[0-9]{1,3}(\.[0-9]{1,3}){3}|localhost)$/i, {
    message: 'must be IP, hostname, or "localhost"',
  });

const CreateSchema = z.object({
  clusterId: z.string().min(1, 'clusterId is required'),
  domain: DomainSchema,
  forwardScheme: z.enum(['http', 'https', 'tcp', 'udp']).default('http'),
  forwardHost: ForwardHostSchema,
  forwardPort: z.number().int().min(1).max(65535),
  /** Для tcp/udp: на каком порту HAProxy слушает входящий трафик. */
  listenPort: z.number().int().min(1).max(65535).nullable().optional(),
  ssl: z.boolean().optional(),
  certificateId: z.string().nullable().optional(),
  httpToHttps: z.boolean().optional(),
  hsts: z.boolean().optional(),
  blockExploits: z.boolean().optional(),
  wsSupport: z.boolean().optional(),
  http2: z.boolean().optional(),
  http3: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  accessGroupIds: z.array(z.string().min(1)).max(32).optional(),
  customHeaders: z
    .record(
      z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
      z
        .string()
        .max(8192)
        .regex(/^[^\r\n]*$/, { message: 'header value must not contain newlines' }),
    )
    .nullish(),
});

const UpdateSchema = CreateSchema.partial().extend({
  enabled: z.boolean().optional(),
});

@ApiTags('proxy-hosts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller()
export class ProxyHostsController {
  constructor(
    private readonly svc: ProxyHostsService,
    private readonly health: ProxyHostsHealthService,
    private readonly logs: HaproxyLogsService,
  ) {}

  @Get('clusters/:clusterId/proxy-hosts')
  list(@Param('clusterId') clusterId: string) {
    return this.svc.list(clusterId);
  }

  @Post('proxy-hosts')
  create(@Body() body: unknown) {
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      throw zodToAppException(parsed.error, {
        domain: ErrorCode.PROXY_HOST_DOMAIN_INVALID,
        forwardHost: ErrorCode.PROXY_HOST_FORWARD_HOST_INVALID,
        clusterId: ErrorCode.CLUSTER_NOT_FOUND,
      });
    }
    return this.svc.create(parsed.data);
  }

  @Patch('proxy-hosts/:id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw zodToAppException(parsed.error, {
        domain: ErrorCode.PROXY_HOST_DOMAIN_INVALID,
        forwardHost: ErrorCode.PROXY_HOST_FORWARD_HOST_INVALID,
      });
    }
    return this.svc.update(id, parsed.data);
  }

  @Delete('proxy-hosts/:id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post('proxy-hosts/:id/health-check')
  @HttpCode(200)
  manualProbe(@Param('id') id: string) {
    return this.health.probeOne(id);
  }

  @Get('proxy-hosts/:id/logs')
  hostLogs(@Param('id') id: string) {
    return this.logs.getLogs(id, 100);
  }

  @Get('proxy-hosts/:id/stats')
  hostStats(@Param('id') id: string) {
    return this.logs.getStats(id);
  }
}
