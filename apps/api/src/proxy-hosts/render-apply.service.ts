import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessGroup, ErrorFile } from '@prisma/client';
import { CryptoService } from '../certificates/crypto.service';
import { AppException, ErrorCode } from '../common/errors';
import { TransportFactory } from '../haproxy/transports/transport.factory';
import type { RenderedTree } from '../haproxy/types';
import { PrismaService } from '../prisma/prisma.service';
import { GeoListsService } from './geo-lists.service';

export interface NodeDeployResult {
  nodeId: string;
  nodeName: string;
  transport: 'LOCAL' | 'SSH';
  ok: boolean;
  error?: string;
}

const execAsync = promisify(exec);

function parseCustomHeadersJson(raw: unknown): Record<string, string> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (typeof v !== 'string') continue;
    if (!/^[a-z0-9._-]+$/.test(lk)) continue;
    if (/[\r\n]/.test(v)) continue; // не пускаем CRLF в haproxy.cfg
    out[lk] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function escapeHaproxyDoubleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface ProxyHostWithAccess {
  id: string;
  domain: string;
  forwardScheme: 'http' | 'https' | 'tcp' | 'udp';
  forwardHost: string;
  forwardPort: number;
  listenPort: number | null;
  ssl: boolean;
  certificateId: string | null;
  httpToHttps: boolean;
  blockExploits: boolean;
  wsSupport: boolean;
  http2: boolean;
  enabled: boolean;
  accessGroupIds: string[];
  customHeaders: Record<string, string> | null;
}

interface ResolvedAccessGroup {
  id: string;
  hasIp: boolean;
  hasDeny: boolean;
  hasAuth: boolean;
  ipLines: string[];
  denyLines: string[];
  /** ISO 3166-1 alpha-2 (lowercase) — страны под гео-блокировкой. */
  geoCodes: string[];
  /** ISO коды стран, ТОЛЬКО из которых разрешён доступ (пусто = без ограничения). */
  geoAllowCodes: string[];
  users: { username: string; passwordPlain: string }[];
}

/**
 * Рендер haproxy.cfg из ProxyHost'ов + сертификатов и hot-reload контейнера.
 *
 *  - Панель доступна ТОЛЬКО на своём порту (WEB_PORT, default 8080) через
 *    fe_panel. На :80/:443 живут только proxy host'ы; неизвестный домен
 *    получает 404, а не панель.
 *  - Per-host логика: hdr(host) на :80 и :443. На HTTPS специально НЕ
 *    маршрутизируем по ssl_fc_sni — браузеры с HTTP/2 connection coalescing
 *    переиспользуют один TLS-сокет (один SNI) для нескольких хостов под общим
 *    wildcard-сертом, и тогда роут по SNI отправит запрос не в тот backend.
 *  - Сертификаты пишутся в /etc/haproxy/certs/<safe>.pem, HAProxy грузит
 *    их через `bind *:443 ssl crt /etc/haproxy/certs/`.
 *  - Reload — `docker kill -s USR2 haproxy-balancer` (api имеет docker.sock).
 */
@Injectable()
export class ProxyHostsRenderApplyService {
  private readonly logger = new Logger(ProxyHostsRenderApplyService.name);
  private readonly dataDir: string;
  private readonly certsDirInContainer = '/etc/haproxy/certs';
  private readonly haproxyContainer: string;
  private readonly webPort: number;
  private readonly apiPort: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly cfg: ConfigService,
    private readonly geoLists: GeoListsService,
    private readonly transports: TransportFactory,
  ) {
    this.dataDir = this.cfg.get<string>('HAPROXY_DATA_DIR') ?? '/haproxy-data';
    this.haproxyContainer = this.cfg.get<string>('HAPROXY_CONTAINER_NAME') ?? 'haproxy-balancer';
    this.webPort = Number(this.cfg.get<string>('WEB_PORT') ?? 8080);
    this.apiPort = Number(this.cfg.get<string>('PORT') ?? 3000);
  }

  /**
   * Полный цикл: рендер всех ProxyHost'ов кластера + сертификатов на диск +
   * reload haproxy. Best-effort: ошибки rendering/IO бросаются как AppException,
   * ошибки docker kill логируются warning'ом, но не падают.
   */
  async apply(clusterId: string): Promise<{
    hostsApplied: number;
    certsLoaded: number;
    reloadOk: boolean;
    reloadError?: string;
    nodes: NodeDeployResult[];
  }> {
    // 1) Запросить данные
    const cluster = await this.prisma.cluster.findUnique({
      where: { id: clusterId },
      select: { logFormat: true, nodes: true },
    });

    // Ноды кластера определяют, КУДА едет конфиг. Локальный haproxy трогаем
    // только если у ЭТОГО кластера есть LOCAL-нода — иначе кластеры
    // перезаписывали бы один общий /haproxy-data/haproxy.cfg.
    const clusterNodes = cluster?.nodes ?? [];
    const localNode = clusterNodes.find((n) => n.transport === 'LOCAL') ?? null;
    const sshNodes = clusterNodes.filter((n) => n.transport === 'SSH');
    const useLocal = localNode !== null;
    const rawHosts = await this.prisma.proxyHost.findMany({
      where: { clusterId, enabled: true },
      orderBy: { createdAt: 'asc' },
      include: {
        accessGroupMemberships: { select: { accessGroupId: true } },
      },
    });

    const certIds = Array.from(
      new Set(rawHosts.map((h) => h.certificateId).filter((x): x is string => !!x)),
    );
    const certs = await this.prisma.certificate.findMany({
      where: { id: { in: certIds } },
    });
    const _certById = new Map(certs.map((c) => [c.id, c]));

    const hosts: ProxyHostWithAccess[] = rawHosts.map((h) => ({
      id: h.id,
      domain: h.domain,
      forwardScheme: h.forwardScheme,
      forwardHost: h.forwardHost,
      forwardPort: h.forwardPort,
      listenPort: h.listenPort,
      ssl: h.ssl,
      certificateId: h.certificateId,
      httpToHttps: h.httpToHttps,
      blockExploits: h.blockExploits,
      wsSupport: h.wsSupport,
      http2: h.http2,
      enabled: h.enabled,
      accessGroupIds: h.accessGroupMemberships.map((m) => m.accessGroupId),
      customHeaders: parseCustomHeadersJson(h.customHeaders),
    }));

    const neededGroupIds = Array.from(
      new Set(
        hosts.flatMap((h) =>
          h.forwardScheme === 'http' || h.forwardScheme === 'https' ? h.accessGroupIds : [],
        ),
      ),
    );
    const groupRows =
      neededGroupIds.length > 0
        ? await this.prisma.accessGroup.findMany({
            where: { clusterId, id: { in: neededGroupIds } },
          })
        : [];
    const groupsById = new Map<string, ResolvedAccessGroup>();
    for (const row of groupRows) {
      groupsById.set(row.id, this.resolveAccessGroupRow(row));
    }

    // 2) Сертификаты: расшифровываем в память; на локальный диск пишем
    // только если у кластера есть LOCAL-нода (иначе затёрли бы certs
    // другого кластера).
    const certsDir = path.join(this.dataDir, 'certs');
    const certFileById = new Map<string, string>(); // certId → filename
    const certFiles = new Map<string, string>(); // filename → pem
    for (const c of certs) {
      try {
        const pem = this.crypto.decryptToString(Buffer.from(c.encryptedPemBlob));
        const safe = c.commonName.replace(/[^a-z0-9.-]/gi, '_');
        const fname = `${safe}_${c.id.slice(-8)}.pem`;
        certFileById.set(c.id, fname);
        certFiles.set(fname, pem);
      } catch (err) {
        this.logger.error(`Failed to decrypt cert ${c.id} (${c.commonName})`, err as Error);
        throw new AppException(
          ErrorCode.INTERNAL,
          `Failed to decrypt certificate ${c.commonName}`,
          500,
        );
      }
    }

    let hasPanelCert = false;
    if (useLocal) {
      await fs.mkdir(certsDir, { recursive: true });
      // Чистим старые .pem. _default.pem не трогаем — это self-signed серт
      // панели (fe_panel на WEB_PORT), его создаёт install.sh.
      try {
        const existing = await fs.readdir(certsDir);
        for (const f of existing) {
          if (f.endsWith('.pem') && f !== '_default.pem')
            await fs.unlink(path.join(certsDir, f)).catch(() => {});
        }
      } catch {
        /* пусто */
      }
      for (const [fname, pem] of certFiles) {
        await fs.writeFile(path.join(certsDir, fname), pem, { mode: 0o600 });
      }
      hasPanelCert = await fs.access(path.join(certsDir, '_default.pem')).then(
        () => true,
        () => false,
      );
    }

    // 2.5) Custom error pages и acl-файлы групп: локальная директория служит
    // и кэшем для SSH-деплоя, и рабочими файлами LOCAL-ноды.
    const errorFiles = await this.writeErrorFiles(clusterId);
    const aclFiles = await this.writeAccessGroupFiles(groupsById);
    // Гео-списки: скачиваем/обновляем geo_<cc>.lst для всех стран из групп
    const neededGeo = Array.from(
      new Set([...groupsById.values()].flatMap((g) => [...g.geoCodes, ...g.geoAllowCodes])),
    );
    await this.geoLists.ensure(neededGeo);

    const hasCerts = certFileById.size > 0;
    const nodeResults: NodeDeployResult[] = [];

    // 3) Локальная нода: рендер с панелью + запись/валидация/reload как раньше.
    let reloadOk = true;
    let reloadError: string | undefined;
    if (useLocal && localNode) {
      const cfg = this.renderCfg(
        hosts,
        hasCerts,
        groupsById,
        hasPanelCert,
        cluster?.logFormat ?? null,
        true,
      );
      const cfgPath = path.join(this.dataDir, 'haproxy.cfg');
      // Прошлый конфиг — для отката, если новый не пройдёт haproxy -c.
      const prevCfg = await fs.readFile(cfgPath, 'utf8').catch(() => null);
      try {
        // ВАЖНО: writeFile перезаписывает по тому же inode — single-file
        // bind mount в haproxy контейнере видит новое содержимое.
        await fs.writeFile(cfgPath, cfg, { mode: 0o640 }); // содержит userlist с basic-auth — не world-readable
      } catch (err) {
        this.logger.error('Failed to write haproxy.cfg', err as Error);
        throw new AppException(ErrorCode.INTERNAL, 'Failed to write haproxy.cfg', 500);
      }

      // Валидация нового конфига ДО reload. Если конфиг битый — haproxy
      // переживёт reload (останется на старом), но упадёт при рестарте
      // контейнера. Поэтому битый конфиг откатываем сразу.
      const check = await this.validateCfg();
      if (!check.ok) {
        if (prevCfg !== null) {
          await fs
            .writeFile(cfgPath, prevCfg, { mode: 0o644 })
            .catch((err) =>
              this.logger.error('Failed to restore previous haproxy.cfg', err as Error),
            );
        }
        throw new AppException(
          ErrorCode.VALIDATION_FAILED,
          `Generated haproxy.cfg failed validation, previous config restored: ${check.output}`,
          422,
        );
      }

      // Перезапустить haproxy (graceful reload через SIGUSR2)
      try {
        await execAsync(`docker kill -s USR2 ${this.haproxyContainer}`, { timeout: 10_000 });
        this.logger.log(
          `Applied locally: ${hosts.length} hosts, ${certFileById.size} certs, ${hosts.filter((x) => x.ssl).length} ssl-bound`,
        );
      } catch (err) {
        reloadOk = false;
        reloadError = err instanceof Error ? err.message : String(err);
        this.logger.warn(`docker kill -s USR2 ${this.haproxyContainer} failed: ${reloadError}`);
      }
      nodeResults.push({
        nodeId: localNode.id,
        nodeName: localNode.name,
        transport: 'LOCAL',
        ok: reloadOk,
        error: reloadError,
      });
    } else if (clusterNodes.length === 0) {
      // Кластер без нод: ничего не деплоим (и не затираем чужой конфиг).
      reloadOk = false;
      reloadError =
        'Cluster has no nodes — config rendered nowhere. Add a node on the Clusters page.';
      this.logger.warn(`apply(${clusterId}): ${reloadError}`);
    } else {
      reloadOk = true; // нет локальной ноды — локальный reload не нужен
    }

    // 4) SSH-ноды: один RenderedTree (без fe_panel — панель живёт только
    // на машине с api), деплой/валидация/reload через SshTransport.
    if (sshNodes.length > 0) {
      const remoteCfg = this.renderCfg(
        hosts,
        hasCerts,
        groupsById,
        false,
        cluster?.logFormat ?? null,
        false,
      );
      const tree: RenderedTree = { files: new Map() };
      tree.files.set('haproxy.cfg', remoteCfg);
      for (const [fname, pem] of certFiles) tree.files.set(`certs/${fname}`, pem);
      for (const [rel, content] of errorFiles) tree.files.set(rel, content);
      for (const [rel, content] of aclFiles) tree.files.set(rel, content);
      for (const cc of neededGeo) {
        const geoContent = await fs
          .readFile(path.join(this.dataDir, 'acl', `geo_${cc}.lst`), 'utf8')
          .catch(() => null);
        if (geoContent !== null) tree.files.set(`acl/geo_${cc}.lst`, geoContent);
      }

      for (const node of sshNodes) {
        const transport = await this.transports.forNode(node);
        let ok = false;
        let error: string | undefined;
        try {
          await transport.deploy(tree);
          await transport.validate();
          await transport.reload();
          ok = true;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          this.logger.warn(`ssh deploy to node ${node.name} failed: ${error}`);
        } finally {
          await transport.close();
        }
        await this.prisma.node
          .update({
            where: { id: node.id },
            data: { status: ok ? 'ONLINE' : 'OFFLINE', ...(ok ? { lastSeenAt: new Date() } : {}) },
          })
          .catch(() => {});
        nodeResults.push({
          nodeId: node.id,
          nodeName: node.name,
          transport: 'SSH',
          ok,
          error,
        });
        if (!ok) reloadOk = false;
      }
    }

    if (!reloadError) {
      reloadError = nodeResults.find((r) => !r.ok)?.error;
    }

    return {
      hostsApplied: hosts.length,
      certsLoaded: certFileById.size,
      reloadOk,
      reloadError,
      nodes: nodeResults,
    };
  }

  /**
   * Прогоняет `haproxy -c` внутри работающего haproxy-контейнера на уже
   * записанном (bind-mounted) haproxy.cfg + conf.d. Возвращает ok=false
   * только если сам haproxy забраковал конфиг; если docker/контейнер
   * недоступны — валидацию пропускаем (best-effort), о проблеме скажет
   * последующий reload.
   */
  private async validateCfg(): Promise<{ ok: boolean; output: string }> {
    const cmd = `docker exec ${this.haproxyContainer} haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg -f /usr/local/etc/haproxy/conf.d/`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 15_000 });
      return { ok: true, output: (stdout || stderr).trim() };
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string };
      const output = (e.stderr || e.stdout || e.message || String(err)).trim();
      // Конфиг забракован, только если ругается сам haproxy ([ALERT]/fatal).
      // Любая инфраструктурная ошибка (docker CLI/демон/контейнер недоступны,
      // таймаут) — не вина конфига: пропускаем валидацию, проблему покажет reload.
      if (/\[ALERT\]|fatal errors found|parsing \[/i.test(output)) {
        return { ok: false, output };
      }
      this.logger.warn(`haproxy -c unavailable, skipping validation: ${output}`);
      return { ok: true, output };
    }
  }

  /**
   * Пишет HAProxy errorfile (*.http): дефолтный HAFlux HTML или кастом из ErrorFile.
   * Возвращает карту relPath → payload (для SSH-деплоя на удалённые ноды).
   */
  private async writeErrorFiles(clusterId: string): Promise<Map<string, string>> {
    const codes = [400, 403, 404, 408, 500, 502, 503, 504];
    const customRows = await this.prisma.errorFile.findMany({
      where: { clusterId },
    });
    const byStatus = new Map<number, ErrorFile>(customRows.map((r) => [r.status, r]));

    const out = new Map<string, string>();
    const errDir = path.join(this.dataDir, 'errors');
    await fs.mkdir(errDir, { recursive: true });
    for (const code of codes) {
      const row = byStatus.get(code);
      let payload: string;
      if (row?.content?.trim()) {
        payload = row.content;
      } else {
        payload = this.buildHttpErrorFilePayload(code, this.renderErrorHtml(code));
      }
      await fs.writeFile(path.join(errDir, `${code}.http`), payload, { mode: 0o644 });
      out.set(`errors/${code}.http`, payload);
    }
    return out;
  }

  /** Полный тело errorfile для HAProxy из HTML-документа (без HTTP-заголовков сверху). */
  buildHttpErrorFilePayload(code: number, htmlBody: string): string {
    const lengthBytes = Buffer.byteLength(htmlBody, 'utf8');
    const head = `HTTP/1.1 ${code} ${this.statusText(code)}\r\nCache-Control: no-cache\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${lengthBytes}\r\nConnection: close\r\n\r\n`;
    return head + htmlBody;
  }

  /** Дефолтное HTML (как в шаблоне HAFlux), без слоя HTTP. */
  defaultErrorPageHtml(code: number): string {
    return this.renderErrorHtml(code);
  }

  private statusText(code: number): string {
    return (
      (
        {
          400: 'Bad Request',
          403: 'Forbidden',
          404: 'Not Found',
          408: 'Request Timeout',
          500: 'Internal Server Error',
          502: 'Bad Gateway',
          503: 'Service Unavailable',
          504: 'Gateway Timeout',
        } as Record<number, string>
      )[code] ?? 'Error'
    );
  }

  private renderErrorHtml(code: number): string {
    const explain =
      (
        {
          400: 'Malformed request — check headers, method or body.',
          403: 'Access denied by access list or authentication.',
          404: 'No proxy host is configured for this domain.',
          408: 'Client took too long to send the request.',
          500: 'Upstream returned an internal error.',
          502: 'No upstream server available right now.',
          503: 'Service is temporarily unavailable. Try again shortly.',
          504: 'Upstream did not reply in time.',
        } as Record<number, string>
      )[code] ?? 'Something went wrong.';
    const text = this.statusText(code);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${code} ${text}</title>
<style>
:root{color-scheme:light dark}
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden}
body{background:#fff;color:#000;font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;align-items:center;justify-content:center;padding:2rem}
@media(prefers-color-scheme:dark){body{background:#000;color:#fff}}
.card{max-width:540px;width:100%;border:1px solid currentColor;opacity:.92;padding:2rem 2rem 1.5rem;border-radius:2px}
.label{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.55}
h1{font-size:2.5rem;margin:.5rem 0 .25rem;letter-spacing:-.015em}
h1::before{content:'> ';opacity:.55}
p{margin:1rem 0 0;line-height:1.6;opacity:.8;font-size:14px}
.meta{margin-top:1.5rem;font-size:11px;opacity:.55;display:flex;gap:1rem;flex-wrap:wrap}
.scan{background-image:repeating-linear-gradient(180deg,transparent 0,transparent 3px,rgba(127,127,127,.05) 3px,rgba(127,127,127,.05) 4px)}
</style></head>
<body class="scan">
<div class="card">
<div class="label">[ HAFlux · ${code} ]</div>
<h1>${text}</h1>
<p>${explain}</p>
<div class="meta"><span>HAFlux</span><span>code: ${code}</span></div>
</div>
</body></html>`;
  }

  private resolveAccessGroupRow(row: AccessGroup): ResolvedAccessGroup {
    const ips = ((row.ipAllowlist as string[]) ?? []).map((x) => x.trim()).filter(Boolean);
    const denies = ((row.ipDenylist as string[]) ?? []).map((x) => x.trim()).filter(Boolean);
    const geoCodes = ((row.geoDenylist as string[]) ?? [])
      .map((x) => x.trim().toLowerCase())
      .filter((x) => /^[a-z]{2}$/.test(x));
    const geoAllowCodes = ((row.geoAllowlist as string[]) ?? [])
      .map((x) => x.trim().toLowerCase())
      .filter((x) => /^[a-z]{2}$/.test(x));
    const rawUsers = (row.authUsers as { username: string; passwordEnc: string }[]) ?? [];
    const users = rawUsers.map((u) => ({
      username: u.username,
      passwordPlain: this.crypto.decryptToString(Buffer.from(u.passwordEnc, 'base64')),
    }));
    return {
      id: row.id,
      hasIp: ips.length > 0,
      hasDeny: denies.length > 0,
      hasAuth: users.length > 0,
      ipLines: ips,
      denyLines: denies,
      geoCodes,
      geoAllowCodes,
      users,
    };
  }

  /** Возвращает карту relPath → содержимое (для SSH-деплоя). */
  private async writeAccessGroupFiles(
    groupsById: Map<string, ResolvedAccessGroup>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (groupsById.size === 0) return out;
    const aclDir = path.join(this.dataDir, 'acl');
    await fs.mkdir(aclDir, { recursive: true });
    for (const [id, g] of groupsById) {
      if (g.hasIp) {
        const content = `${g.ipLines.join('\n')}\n`;
        await fs.writeFile(path.join(aclDir, `haflux_${id}.lst`), content, { mode: 0o644 });
        out.set(`acl/haflux_${id}.lst`, content);
      }
      if (g.hasDeny) {
        const content = `${g.denyLines.join('\n')}\n`;
        await fs.writeFile(path.join(aclDir, `haflux_deny_${id}.lst`), content, { mode: 0o644 });
        out.set(`acl/haflux_deny_${id}.lst`, content);
      }
    }
    return out;
  }

  private aclSrcName(groupId: string): string {
    return `hafluxg_${groupId}_src`;
  }

  private aclSrcDenyName(groupId: string): string {
    return `hafluxg_${groupId}_src_deny`;
  }

  private aclGeoName(cc: string): string {
    return `geo_${cc}_src`;
  }

  private escapePwdForUserlist(p: string): string {
    if (/^[a-zA-Z0-9._~:-]+$/.test(p)) return p;
    return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  private hostMergedUlName(hostId: string): string {
    return `haflux_ul_host_${hostId}`;
  }

  /** Один userlist на хост: пользователи всех привязанных групп (дубликаты имён — первый выигрывает). */
  private renderHostAuthUserlists(
    httpHosts: ProxyHostWithAccess[],
    groupsById: Map<string, ResolvedAccessGroup>,
  ): string {
    const lines: string[] = [];
    for (const h of httpHosts) {
      const groups = h.accessGroupIds
        .map((id) => groupsById.get(id))
        .filter((g): g is ResolvedAccessGroup => !!g);
      const merged: { username: string; passwordPlain: string }[] = [];
      const seen = new Set<string>();
      for (const g of groups) {
        for (const u of g.users) {
          if (seen.has(u.username)) continue;
          seen.add(u.username);
          merged.push(u);
        }
      }
      if (merged.length === 0) continue;
      lines.push(`userlist ${this.hostMergedUlName(h.id)}`);
      for (const u of merged) {
        const uname = /^[a-zA-Z0-9_]+$/.test(u.username)
          ? u.username
          : `"${u.username.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        lines.push(
          `  user ${uname} insecure-password ${this.escapePwdForUserlist(u.passwordPlain)}`,
        );
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private renderCfg(
    hosts: ProxyHostWithAccess[],
    hasCerts: boolean,
    groupsById: Map<string, ResolvedAccessGroup>,
    hasPanelCert: boolean,
    logFormat: string | null,
    includePanel: boolean,
  ): string {
    const httpHosts = hosts.filter(
      (h) => h.forwardScheme === 'http' || h.forwardScheme === 'https',
    );
    const tcpHosts = hosts.filter((h) => h.forwardScheme === 'tcp' || h.forwardScheme === 'udp');

    const out: string[] = [];
    out.push(`# Auto-generated by HAFlux. Do not edit manually.
# Render time: ${new Date().toISOString()}

global
  maxconn 4000
  log stdout local0 info
  ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets
  stats socket /var/run/haproxy.sock mode 0660 level admin
`);

    const hostAuthLists = this.renderHostAuthUserlists(httpHosts, groupsById);
    if (hostAuthLists.trim()) out.push(hostAuthLists);

    // log-format с req.fhdr(...) в defaults роняет HAProxy 3.1 (strict).
    // Используем httplog в defaults, кастомный формат — на frontend'ах.
    out.push(`defaults
  mode http
  log global
  option httplog
  option dontlognull
  option forwardfor
  timeout connect 5s
  timeout client  60s
  timeout server  60s
  errorfile 400 /etc/haproxy/errors/400.http
  errorfile 403 /etc/haproxy/errors/403.http
  errorfile 404 /etc/haproxy/errors/404.http
  errorfile 408 /etc/haproxy/errors/408.http
  errorfile 500 /etc/haproxy/errors/500.http
  errorfile 502 /etc/haproxy/errors/502.http
  errorfile 503 /etc/haproxy/errors/503.http
  errorfile 504 /etc/haproxy/errors/504.http
`);

    // Кастомный log-format кластера — на frontend'ах (в defaults c
    // req.fhdr(...) HAProxy 3.1 strict падает).
    const logFormatLine = logFormat
      ? `  log-format "${escapeHaproxyDoubleQuoted(logFormat)}"`
      : null;

    // ── Frontend :80 ─────────────────────────────────────────
    // Без кастомного формата — option httplog в defaults даёт стандартный.
    // capture user-agent делаем явно, чтобы не пропадало в логах.
    out.push('frontend fe_http');
    out.push('  bind *:80');
    if (logFormatLine) out.push(logFormatLine);
    out.push('  capture request header User-Agent len 200');
    out.push('');

    // Per-host ACL по Host header. Для wildcard используем hdr_end по
    // суффиксу (литеральная строка "*.example.com" в Host никогда не приходит).
    for (const h of httpHosts) {
      if (h.domain.startsWith('*.')) {
        out.push(`  acl host_${h.id} hdr_end(host) -i .${h.domain.slice(2)}`);
      } else {
        out.push(`  acl host_${h.id} hdr(host) -i ${h.domain}`);
      }
    }
    out.push('');

    {
      const feHttpGroupIds = new Set<string>();
      const feHttpDenyGroupIds = new Set<string>();
      const feHttpGeoCodes = new Set<string>();
      for (const h of httpHosts) {
        for (const gid of h.accessGroupIds) {
          const g = groupsById.get(gid);
          // denylist/гео действуют всегда, даже на хостах с редиректом на HTTPS
          if (g?.hasDeny) feHttpDenyGroupIds.add(gid);
          for (const cc of g?.geoCodes ?? []) feHttpGeoCodes.add(cc);
          if (h.ssl && h.httpToHttps) continue;
          for (const cc of g?.geoAllowCodes ?? []) feHttpGeoCodes.add(cc);
          if (g?.hasIp) feHttpGroupIds.add(gid);
        }
      }
      for (const gid of feHttpDenyGroupIds) {
        out.push(
          `  acl ${this.aclSrcDenyName(gid)} src -f /etc/haproxy/acl/haflux_deny_${gid}.lst`,
        );
      }
      for (const cc of feHttpGeoCodes) {
        out.push(`  acl ${this.aclGeoName(cc)} src -f /etc/haproxy/acl/geo_${cc}.lst`);
      }
      for (const gid of feHttpGroupIds) {
        out.push(`  acl ${this.aclSrcName(gid)} src -f /etc/haproxy/acl/haflux_${gid}.lst`);
      }
      if (feHttpGroupIds.size > 0 || feHttpDenyGroupIds.size > 0 || feHttpGeoCodes.size > 0)
        out.push('');
    }

    // 0) IP/гео denylist: блокируем раньше всего остального (включая redirect).
    for (const h of httpHosts) {
      for (const gid of h.accessGroupIds) {
        const g = groupsById.get(gid);
        if (!g) continue;
        if (g.hasDeny) {
          out.push(
            `  http-request deny deny_status 403 if host_${h.id} ${this.aclSrcDenyName(gid)}`,
          );
        }
        for (const cc of g.geoCodes) {
          out.push(`  http-request deny deny_status 403 if host_${h.id} ${this.aclGeoName(cc)}`);
        }
      }
    }

    // 1) blockExploits — http-request rules ВСЕГДА должны быть до redirect/use_backend,
    // иначе HAProxy 3.x пишет warning «http-request rule placed after a 'redirect'
    // rule will still be processed before». Чтобы конфиг рендерился без warning'ов,
    // деним в первую очередь.
    for (const h of httpHosts) {
      if (h.blockExploits) {
        out.push(
          `  http-request deny if host_${h.id} { path_beg /.git /.env /.svn /.aws /.docker }`,
        );
      }
    }

    // 2) httpToHttps redirects
    for (const h of httpHosts) {
      if (h.ssl && h.httpToHttps) {
        out.push(`  redirect scheme https code 301 if host_${h.id}`);
      }
    }

    // 2b) Группы доступа (IP allowlist + Basic Auth) на :80 (без редиректа на HTTPS).
    // Несколько групп на хост => OR: достаточно попасть в любой из allowlist'ов.
    for (const h of httpHosts) {
      if (h.ssl && h.httpToHttps) continue;
      if (h.accessGroupIds.length === 0) continue;
      const ipGids = h.accessGroupIds.filter((gid) => groupsById.get(gid)?.hasIp);
      if (ipGids.length > 0) {
        const negations = ipGids.map((gid) => `!${this.aclSrcName(gid)}`).join(' ');
        out.push(`  http-request deny deny_status 403 if host_${h.id} ${negations}`);
      }
      // Гео-allowlist: доступ только из перечисленных стран (объединение по группам).
      const geoAllow = Array.from(
        new Set(h.accessGroupIds.flatMap((gid) => groupsById.get(gid)?.geoAllowCodes ?? [])),
      );
      if (geoAllow.length > 0) {
        const negations = geoAllow.map((cc) => `!${this.aclGeoName(cc)}`).join(' ');
        out.push(`  http-request deny deny_status 403 if host_${h.id} ${negations}`);
      }
      const needsAuth = h.accessGroupIds.some((gid) => groupsById.get(gid)?.hasAuth);
      if (needsAuth) {
        const ulName = this.hostMergedUlName(h.id);
        const ackName = `auth_ok_${h.id}`;
        out.push(`  acl ${ackName} http_auth(${ulName})`);
        out.push(`  http-request auth realm "HAFlux" if host_${h.id} !${ackName}`);
      }
    }

    // 3) Хосты без TLS terminate'а или без redirect → use_backend
    for (const h of httpHosts) {
      if (h.ssl && h.httpToHttps) continue;
      out.push(`  use_backend be_proxy_${h.id} if host_${h.id}`);
    }

    // 4) Неизвестный домен → 404. Панель на :80 НЕ выставляем: она живёт
    // только на своём порту (fe_panel ниже), чтобы приземлённый на сервер
    // домен не показывал панель.
    out.push('  default_backend be_no_match');
    out.push('');

    // ── Frontend :443 (только если есть сертификаты) ────────
    // Маршрутизация по hdr(host) (НЕ по ssl_fc_sni): wildcard-серт *.example.com
    // покрывает несколько имён, и HTTP/2 клиенты будут coalescing'ом гонять
    // запросы для всех этих имён через один TLS-сокет с одним SNI. Если
    // роутить по SNI — попадёт не в тот backend.
    //
    // В fe_https включаем ВСЕ enabled hosts (а не только ssl=true): если
    // wildcard-серт случайно покрывает host с ssl=false, мы не хотим, чтобы
    // он валился в 503 NOSRV (видим на проде, см. инцидент 2026-05-05).
    if (hasCerts) {
      const httpsHosts = httpHosts;
      const anyH2 = httpsHosts.some((h) => h.http2);
      const alpnList = anyH2 ? 'h2,http/1.1' : 'http/1.1';

      out.push('frontend fe_https');
      out.push(`  bind *:443 ssl crt ${this.certsDirInContainer}/ alpn ${alpnList}`);
      if (logFormatLine) out.push(logFormatLine);
      out.push('  capture request header User-Agent len 200');
      out.push('  http-request set-header X-Forwarded-Proto https');
      out.push('');

      for (const h of httpsHosts) {
        if (h.domain.startsWith('*.')) {
          out.push(`  acl host_${h.id} hdr_end(host) -i .${h.domain.slice(2)}`);
        } else {
          out.push(`  acl host_${h.id} hdr(host) -i ${h.domain}`);
        }
      }
      out.push('');

      {
        const feHttpsGroupIds = new Set<string>();
        const feHttpsDenyGroupIds = new Set<string>();
        const feHttpsGeoCodes = new Set<string>();
        for (const h of httpsHosts) {
          for (const gid of h.accessGroupIds) {
            const g = groupsById.get(gid);
            if (g?.hasIp) feHttpsGroupIds.add(gid);
            if (g?.hasDeny) feHttpsDenyGroupIds.add(gid);
            for (const cc of g?.geoCodes ?? []) feHttpsGeoCodes.add(cc);
            for (const cc of g?.geoAllowCodes ?? []) feHttpsGeoCodes.add(cc);
          }
        }
        for (const gid of feHttpsDenyGroupIds) {
          out.push(
            `  acl ${this.aclSrcDenyName(gid)} src -f /etc/haproxy/acl/haflux_deny_${gid}.lst`,
          );
        }
        for (const cc of feHttpsGeoCodes) {
          out.push(`  acl ${this.aclGeoName(cc)} src -f /etc/haproxy/acl/geo_${cc}.lst`);
        }
        for (const gid of feHttpsGroupIds) {
          out.push(`  acl ${this.aclSrcName(gid)} src -f /etc/haproxy/acl/haflux_${gid}.lst`);
        }
        if (feHttpsGroupIds.size > 0 || feHttpsDenyGroupIds.size > 0 || feHttpsGeoCodes.size > 0)
          out.push('');
      }

      // IP/гео denylist: проверяется раньше allowlist/auth.
      for (const h of httpsHosts) {
        for (const gid of h.accessGroupIds) {
          const g = groupsById.get(gid);
          if (!g) continue;
          if (g.hasDeny) {
            out.push(
              `  http-request deny deny_status 403 if host_${h.id} ${this.aclSrcDenyName(gid)}`,
            );
          }
          for (const cc of g.geoCodes) {
            out.push(`  http-request deny deny_status 403 if host_${h.id} ${this.aclGeoName(cc)}`);
          }
        }
      }

      // blockExploits also on https
      for (const h of httpsHosts) {
        if (h.blockExploits) {
          out.push(
            `  http-request deny if host_${h.id} { path_beg /.git /.env /.svn /.aws /.docker }`,
          );
        }
      }

      // Группы доступа на :443. Multi-group => OR (см. fe_http выше).
      for (const h of httpsHosts) {
        if (h.accessGroupIds.length === 0) continue;
        const ipGids = h.accessGroupIds.filter((gid) => groupsById.get(gid)?.hasIp);
        if (ipGids.length > 0) {
          const negations = ipGids.map((gid) => `!${this.aclSrcName(gid)}`).join(' ');
          out.push(`  http-request deny deny_status 403 if host_${h.id} ${negations}`);
        }
        // Гео-allowlist: доступ только из перечисленных стран (объединение по группам).
        const geoAllow = Array.from(
          new Set(h.accessGroupIds.flatMap((gid) => groupsById.get(gid)?.geoAllowCodes ?? [])),
        );
        if (geoAllow.length > 0) {
          const negations = geoAllow.map((cc) => `!${this.aclGeoName(cc)}`).join(' ');
          out.push(`  http-request deny deny_status 403 if host_${h.id} ${negations}`);
        }
        const needsAuth = h.accessGroupIds.some((gid) => groupsById.get(gid)?.hasAuth);
        if (needsAuth) {
          const ulName = this.hostMergedUlName(h.id);
          const ackName = `auth_ok_${h.id}`;
          out.push(`  acl ${ackName} http_auth(${ulName})`);
          out.push(`  http-request auth realm "HAFlux" if host_${h.id} !${ackName}`);
        }
      }

      // Misdirected должен идти ДО use_backend (HAProxy 3 ругается на
      // 'http-request' после 'use_backend'). Без SNI современные клиенты
      // (browsers, curl) не ходят — это или legacy IE6/Symbian, или ошибка.
      out.push(
        '  http-request return status 421 content-type text/plain string "Misdirected" if !{ ssl_fc_has_sni }',
      );

      for (const h of httpsHosts) {
        out.push(`  use_backend be_proxy_${h.id} if host_${h.id}`);
      }
      // SNI есть, но ни один хост не совпал → 404 (не панель!)
      out.push('  default_backend be_no_match');
      out.push('');
    }

    // ── Frontend панели: ТОЛЬКО кастомный порт ───────────────
    // Self-signed _default.pem кладёт install.sh; если его нет (например,
    // dev-окружение без инсталлера) — слушаем plain http.
    // На удалённых (SSH) нодах панель не рендерим: api живёт не там.
    if (includePanel) {
      out.push('frontend fe_panel');
      if (hasPanelCert) {
        out.push(
          `  bind *:${this.webPort} ssl crt ${this.certsDirInContainer}/_default.pem alpn h2,http/1.1`,
        );
      } else {
        out.push(`  bind *:${this.webPort}`);
      }
      out.push('  default_backend be_panel');
      out.push('');
    }

    // ── L4 listen блоки (TCP/UDP host'ы) ────────────────────
    // Каждый TCP-host = отдельный listen с уникальным портом (listenPort).
    // UDP в HAProxy упрощён до 'experimental' (в большинстве сборок не
    // поддерживается mode udp). Для UDP оставляем backend-описание + warning.
    for (const h of tcpHosts) {
      if (!h.listenPort) {
        // нет listenPort — пропускаем но логируем в комментарии cfg
        out.push(`# WARN: skipped tcp host ${h.id} (${h.domain}) — listenPort not set`);
        continue;
      }
      if (h.forwardScheme === 'tcp') {
        out.push(`listen ltcp_${h.id}`);
        out.push(`  bind *:${h.listenPort}`);
        out.push('  mode tcp');
        out.push('  option tcplog');
        out.push(`  server upstream ${h.forwardHost}:${h.forwardPort} check`);
        out.push('');
      } else {
        // udp — placeholder; включаем когда HAProxy с experimental.
        out.push(
          `# WARN: udp scheme is experimental in HAProxy — host ${h.id} (${h.domain}) skipped`,
        );
      }
    }

    // ── Backends ─────────────────────────────────────────────
    // Панель: api контейнер сам раздаёт и SPA (статика через
    // @fastify/static) и REST. nginx больше нет.
    if (includePanel) {
      out.push(`backend be_panel
  server api 127.0.0.1:${this.apiPort} check
`);
    }

    // Домены, не привязанные ни к одному proxy host → 404
    out.push(`backend be_no_match
  http-request deny deny_status 404
`);

    for (const h of httpHosts) {
      const useSsl = h.forwardScheme === 'https' ? ' ssl verify none' : '';
      // timeout client-fin валиден только в frontend/defaults — в backend HAProxy 3.x
      // ругается warning'ом «no frontend capability». Здесь оставляем только tunnel.
      const tunnelTimeouts = h.wsSupport ? '\n  timeout tunnel 1h' : '';
      const headerLines =
        h.customHeaders != null
          ? Object.entries(h.customHeaders)
              .map(
                ([name, val]) =>
                  `  http-request set-header ${name} "${escapeHaproxyDoubleQuoted(val)}"`,
              )
              .join('\n')
          : '';
      const headerBlock = headerLines ? `${headerLines}\n` : '';
      out.push(`backend be_proxy_${h.id}
  option http-server-close
${headerBlock}  server upstream ${h.forwardHost}:${h.forwardPort} check${useSsl}${tunnelTimeouts}
`);
    }

    return out.join('\n');
  }
}
