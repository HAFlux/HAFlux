import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Машиночитаемые коды ошибок API. Фронт пишет message → юзер по language,
 * но логика (форма vs сеть, retry vs показать) строится на code.
 */
export enum ErrorCode {
  // ── Generic
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  INTERNAL = 'INTERNAL',

  // ── Email validation
  EMAIL_REQUIRED = 'EMAIL_REQUIRED',
  EMAIL_INVALID_FORMAT = 'EMAIL_INVALID_FORMAT',
  EMAIL_RESERVED_TLD = 'EMAIL_RESERVED_TLD',

  // ── Domain validation
  DOMAIN_REQUIRED = 'DOMAIN_REQUIRED',
  DOMAIN_INVALID = 'DOMAIN_INVALID',

  // ── Cluster
  CLUSTER_NAME_REQUIRED = 'CLUSTER_NAME_REQUIRED',
  CLUSTER_NAME_INVALID = 'CLUSTER_NAME_INVALID',
  CLUSTER_NAME_TAKEN = 'CLUSTER_NAME_TAKEN',
  CLUSTER_NOT_FOUND = 'CLUSTER_NOT_FOUND',

  // ── DNS Provider / Cloudflare
  PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
  PROVIDER_KIND_UNSUPPORTED = 'PROVIDER_KIND_UNSUPPORTED',
  CLOUDFLARE_TOKEN_INVALID = 'CLOUDFLARE_TOKEN_INVALID',
  CLOUDFLARE_TOKEN_INACTIVE = 'CLOUDFLARE_TOKEN_INACTIVE',
  CLOUDFLARE_NO_ZONES = 'CLOUDFLARE_NO_ZONES',
  CLOUDFLARE_API_ERROR = 'CLOUDFLARE_API_ERROR',

  // ── ACME / Certificates
  ACME_FAILED = 'ACME_FAILED',
  CERT_NOT_FOUND = 'CERT_NOT_FOUND',
  ZONE_NOT_FOUND = 'ZONE_NOT_FOUND',
  ORG_NOT_BOOTSTRAPPED = 'ORG_NOT_BOOTSTRAPPED',

  // ── Proxy Hosts
  PROXY_HOST_NOT_FOUND = 'PROXY_HOST_NOT_FOUND',
  PROXY_HOST_DOMAIN_TAKEN = 'PROXY_HOST_DOMAIN_TAKEN',
  PROXY_HOST_DOMAIN_INVALID = 'PROXY_HOST_DOMAIN_INVALID',
  PROXY_HOST_FORWARD_HOST_INVALID = 'PROXY_HOST_FORWARD_HOST_INVALID',
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  /** Дополнительные поля (например, какой именно field провалил валидацию). */
  details?: Record<string, unknown>;
  statusCode: number;
  error: string; // human-readable HTTP statusName, например "Bad Request"
}

/**
 * Бросаем эту экспепшн вместо BadRequestException/NotFoundException, чтобы
 * клиент получал стабильный body.code наряду с message.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    const body: ApiErrorBody = {
      code,
      message,
      details,
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
    };
    super(body, status);
  }
}
