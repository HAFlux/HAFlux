import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { CloudflareCredentialsSchema } from '@hapilot/contracts';
import { CloudflareDnsProvider } from './cloudflare.provider';
import { CertificatesService } from './certificates.service';
import { CertificateRenewService } from './renew.service';
import { ErrorCode } from '../common/errors';
import { zodToAppException } from '../common/zod-to-error';

/**
 * ACME-валидное email требует:
 *  - корректный формат (RFC-ish)
 *  - public TLD (минимум 2 символа после последней точки и не reserved
 *    типа .local / .localhost / .test / .invalid).
 * LE отвергает .local — поэтому делаем явный блок-лист.
 */
const RESERVED_TLDS = new Set(['local', 'localhost', 'test', 'invalid', 'example']);

const IssueRequestSchema = z.object({
  providerId: z.string().min(1, 'providerId is required'),
  domain: z
    .string()
    .min(3, 'domain is required')
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, {
      message: 'must be a valid hostname',
    }),
  wildcard: z.boolean().optional(),
  staging: z.boolean().optional(),
  email: z
    .string({ required_error: 'email is required' })
    .min(1, 'email is required')
    .email('must be a valid address')
    .refine(
      (v) => {
        const tld = v.split('@')[1]?.split('.').pop()?.toLowerCase();
        return tld !== undefined && tld.length >= 2 && !RESERVED_TLDS.has(tld);
      },
      { message: '.local / .test / .localhost are rejected by Let\'s Encrypt' },
    ),
});

@ApiTags('certificates')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('certificates')
export class CertificatesController {
  constructor(
    private readonly cf: CloudflareDnsProvider,
    private readonly svc: CertificatesService,
    private readonly renew: CertificateRenewService,
  ) {}

  // ── Verify CF token (без сохранения) ──────────────────────────────
  @Post('providers/cloudflare/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify Cloudflare API token and list zones' })
  async verifyCloudflare(@Body() body: unknown) {
    const parsed = CloudflareCredentialsSchema.parse(body);
    return this.cf.verifyCredentials(parsed);
  }

  // ── DNS providers CRUD ────────────────────────────────────────────
  @Get('providers')
  listProviders() {
    return this.svc.listProviders();
  }

  @Post('providers/cloudflare')
  saveCloudflare(
    @Body() body: { name: string; apiToken: string; accountId?: string },
  ) {
    return this.svc.saveCloudflareProvider(body);
  }

  @Delete('providers/:id')
  deleteProvider(@Param('id') id: string) {
    return this.svc.deleteProvider(id);
  }

  // ── Certificates ──────────────────────────────────────────────────
  @Get()
  listCerts() {
    return this.svc.listCertificates();
  }

  @Post('issue')
  @HttpCode(202)
  @ApiOperation({ summary: 'Issue (wildcard) cert via DNS-01 ACME' })
  issue(@Body() body: unknown) {
    const parsed = IssueRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw zodToAppException(parsed.error, {
        email: ErrorCode.EMAIL_INVALID_FORMAT,
        domain: ErrorCode.DOMAIN_INVALID,
        providerId: ErrorCode.PROVIDER_NOT_FOUND,
      });
    }
    return this.svc.issueWildcard({
      providerId: parsed.data.providerId,
      domain: parsed.data.domain,
      wildcard: parsed.data.wildcard ?? true,
      email: parsed.data.email,
      // Production по умолчанию (валидные browser-trusted сертификаты).
      // Staging — opt-in для тестов: cert от 'STAGING' CA не доверяется.
      staging: parsed.data.staging ?? false,
    });
  }

  @Post('upload')
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload existing PEM certificate (cert + key)' })
  uploadCert(@Body() body: unknown) {
    const o = (body ?? {}) as { certPem?: unknown; keyPem?: unknown };
    if (typeof o.certPem !== 'string' || typeof o.keyPem !== 'string') {
      throw new BadRequestException('Both certPem and keyPem are required');
    }
    return this.svc.uploadCertificate({ certPem: o.certPem, keyPem: o.keyPem });
  }

  @Delete(':id')
  deleteCert(@Param('id') id: string) {
    return this.svc.deleteCertificate(id);
  }

  @Post(':id/renew')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renew an ACME certificate now' })
  renewCert(@Param('id') id: string) {
    return this.renew.renew(id);
  }
}
