import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCode } from '../common/errors';
import { zodToAppException } from '../common/zod-to-error';
import { AccessGroupsService } from './access-groups.service';
import { ClusterErrorFilesService, parseClusterErrorPageCode } from './cluster-error-files.service';
import { ClustersService } from './clusters.service';

const ErrorPageHtmlSchema = z.object({
  html: z.string().min(1, 'html is required').max(512_000, 'html is too large'),
});

const CreateClusterSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .min(1, 'name is required')
    .max(64, 'name is too long')
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, {
      message: 'must start with letter/digit; allowed: letters, digits, space, _, -',
    }),
  mode: z.enum(['STANDALONE', 'ACTIVE_PASSIVE', 'ACTIVE_ACTIVE']).optional(),
  orgId: z.string().optional(),
  /** Кастомный log-format (HAProxy syntax, одна строка). null = стандартный httplog. */
  logFormat: z
    .string()
    .max(1024, 'log format is too long')
    .regex(/^[^\r\n]*$/, { message: 'log format must be a single line' })
    .nullable()
    .optional(),
});

@ApiTags('clusters')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('clusters')
export class ClustersController {
  constructor(
    private readonly svc: ClustersService,
    private readonly errorFiles: ClusterErrorFilesService,
    private readonly accessGroups: AccessGroupsService,
  ) {}

  @Get()
  list() {
    return this.svc.listWithCounts();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = CreateClusterSchema.partial().safeParse(body);
    if (!parsed.success) {
      throw zodToAppException(parsed.error, { name: ErrorCode.CLUSTER_NAME_INVALID });
    }
    return this.svc.update(id, parsed.data);
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = CreateClusterSchema.safeParse(body);
    if (!parsed.success) {
      throw zodToAppException(parsed.error, {
        name: ErrorCode.CLUSTER_NAME_INVALID,
      });
    }
    return this.svc.create(parsed.data);
  }

  @Get(':id/error-files')
  listErrorFiles(@Param('id') id: string) {
    return this.errorFiles.list(id);
  }

  @Put(':id/error-files/:code')
  upsertErrorFile(@Param('id') id: string, @Param('code') codeStr: string, @Body() body: unknown) {
    const code = parseClusterErrorPageCode(codeStr);
    const parsed = ErrorPageHtmlSchema.safeParse(body);
    if (!parsed.success) {
      throw zodToAppException(parsed.error);
    }
    return this.errorFiles.upsert(id, code, parsed.data.html);
  }

  @Delete(':id/error-files/:code')
  @HttpCode(200)
  resetErrorFile(@Param('id') id: string, @Param('code') codeStr: string) {
    const code = parseClusterErrorPageCode(codeStr);
    return this.errorFiles.reset(id, code);
  }

  @Get(':id/access-groups')
  listAccessGroups(@Param('id') id: string) {
    return this.accessGroups.list(id);
  }

  @Post(':id/access-groups')
  createAccessGroup(@Param('id') id: string, @Body() body: unknown) {
    return this.accessGroups.create(id, body);
  }

  @Get(':id/access-groups/:groupId')
  getAccessGroup(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.accessGroups.get(id, groupId);
  }

  @Patch(':id/access-groups/:groupId')
  updateAccessGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
  ) {
    return this.accessGroups.update(id, groupId, body);
  }

  @Delete(':id/access-groups/:groupId')
  @HttpCode(200)
  removeAccessGroup(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.accessGroups.remove(id, groupId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Get(':id/nodes')
  listNodes(@Param('id') id: string) {
    return this.svc.listNodes(id);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
