import { z } from 'zod';

// ─── Common ────────────────────────────────────────────────────────────────

export const IdSchema = z.string().min(1);
export const DateTimeSchema = z.string().datetime();

// ─── Auth ──────────────────────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: z.object({
    id: IdSchema,
    email: z.string().email(),
    displayName: z.string().nullable(),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ─── Cluster / Node ────────────────────────────────────────────────────────

export const ClusterModeSchema = z.enum(['STANDALONE', 'ACTIVE_PASSIVE', 'ACTIVE_ACTIVE']);
export type ClusterMode = z.infer<typeof ClusterModeSchema>;

export const NodeStatusSchema = z.enum(['ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeRoleSchema = z.enum(['PRIMARY', 'SECONDARY']);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

export const ClusterSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  mode: ClusterModeSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type Cluster = z.infer<typeof ClusterSchema>;

export const NodeSchema = z.object({
  id: IdSchema,
  clusterId: IdSchema,
  name: z.string().min(1).max(100),
  address: z.string(),
  haproxyVersion: z.string().nullable(),
  status: NodeStatusSchema,
  role: NodeRoleSchema,
  lastSeenAt: DateTimeSchema.nullable(),
});
export type Node = z.infer<typeof NodeSchema>;

// ─── HAProxy entities (упрощённые DTO для UI) ──────────────────────────────

export const HaproxyModeSchema = z.enum(['http', 'tcp']);

export const FrontendSchema = z.object({
  id: IdSchema,
  clusterId: IdSchema,
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  mode: HaproxyModeSchema,
  binds: z
    .array(
      z.object({
        address: z.string(),
        port: z.number().int().min(1).max(65535),
        ssl: z.boolean().default(false),
        certificateRef: z.string().nullable().optional(),
        alpn: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  defaultBackend: z.string().nullable(),
});
export type Frontend = z.infer<typeof FrontendSchema>;

export const ServerEntrySchema = z.object({
  id: IdSchema,
  name: z.string(),
  address: z.string(),
  port: z.number().int().min(1).max(65535),
  weight: z.number().int().min(0).max(256).default(1),
  maxconn: z.number().int().min(0).optional(),
  check: z.boolean().default(true),
  backup: z.boolean().default(false),
  disabled: z.boolean().default(false),
});
export type ServerEntry = z.infer<typeof ServerEntrySchema>;

export const BalanceAlgoSchema = z.enum([
  'roundrobin',
  'leastconn',
  'source',
  'uri',
  'static-rr',
  'random',
]);

export const BackendSchema = z.object({
  id: IdSchema,
  clusterId: IdSchema,
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  mode: HaproxyModeSchema,
  balance: BalanceAlgoSchema.default('roundrobin'),
  servers: z.array(ServerEntrySchema),
  httpCheck: z
    .object({
      uri: z.string().default('/'),
      method: z.enum(['GET', 'HEAD', 'OPTIONS']).default('GET'),
      expectStatus: z.string().default('2xx,3xx'),
    })
    .optional(),
});
export type Backend = z.infer<typeof BackendSchema>;

// ─── Certificates / ACME / Cloudflare ──────────────────────────────────────

export const AcmeProviderSchema = z.enum(['letsencrypt', 'zerossl', 'buypass', 'custom']);
export const DnsProviderKindSchema = z.enum([
  'cloudflare',
  'route53',
  'digitalocean',
  'hetzner',
  'yandex',
  'custom',
]);

export const CloudflareCredentialsSchema = z.object({
  apiToken: z.string().min(20).max(200),
  accountId: z.string().optional(),
});
export type CloudflareCredentials = z.infer<typeof CloudflareCredentialsSchema>;

export const AcmeOrderRequestSchema = z
  .object({
    domains: z.array(z.string().min(1)).min(1),
    wildcard: z.boolean().default(false),
    keyType: z.enum(['ec256', 'ec384', 'rsa2048', 'rsa4096']).default('ec256'),
    provider: AcmeProviderSchema.default('letsencrypt'),
    challenge: z.enum(['http-01', 'dns-01']).default('http-01'),
    dnsProviderId: IdSchema.optional(),
  })
  .refine((v) => v.challenge === 'http-01' || !!v.dnsProviderId, {
    message: 'dnsProviderId is required for dns-01 challenge',
    path: ['dnsProviderId'],
  });
export type AcmeOrderRequest = z.infer<typeof AcmeOrderRequestSchema>;

export const CertificateSchema = z.object({
  id: IdSchema,
  commonName: z.string(),
  sans: z.array(z.string()),
  issuer: z.string(),
  notBefore: DateTimeSchema,
  notAfter: DateTimeSchema,
  source: z.enum(['UPLOAD', 'ACME']),
  fingerprintSha256: z.string(),
});
export type Certificate = z.infer<typeof CertificateSchema>;

// ─── Error codes ───────────────────────────────────────────────────────

export const ErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CONFLICT',
  'INTERNAL',
  'EMAIL_REQUIRED',
  'EMAIL_INVALID_FORMAT',
  'EMAIL_RESERVED_TLD',
  'DOMAIN_REQUIRED',
  'DOMAIN_INVALID',
  'CLUSTER_NAME_REQUIRED',
  'CLUSTER_NAME_INVALID',
  'CLUSTER_NAME_TAKEN',
  'CLUSTER_NOT_FOUND',
  'PROVIDER_NOT_FOUND',
  'PROVIDER_KIND_UNSUPPORTED',
  'CLOUDFLARE_TOKEN_INVALID',
  'CLOUDFLARE_TOKEN_INACTIVE',
  'CLOUDFLARE_NO_ZONES',
  'CLOUDFLARE_API_ERROR',
  'ACME_FAILED',
  'CERT_NOT_FOUND',
  'ZONE_NOT_FOUND',
  'ORG_NOT_BOOTSTRAPPED',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  statusCode: z.number(),
  error: z.string(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

// ─── Apply / Versions ──────────────────────────────────────────────────────

export const ApplyJobStatusSchema = z.enum([
  'PENDING',
  'VALIDATING',
  'APPLYING',
  'SUCCESS',
  'FAILED',
  'ROLLED_BACK',
]);
export type ApplyJobStatus = z.infer<typeof ApplyJobStatusSchema>;

export const ConfigVersionSchema = z.object({
  id: IdSchema,
  clusterId: IdSchema,
  gitSha: z.string(),
  authorEmail: z.string().email().nullable(),
  message: z.string(),
  createdAt: DateTimeSchema,
});
export type ConfigVersion = z.infer<typeof ConfigVersionSchema>;
