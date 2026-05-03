/**
 * Артефакт рендера: дерево файлов, которое нужно положить на ноду.
 * Ключ — путь относительно корня haproxy-data (например, "haproxy.cfg",
 * "conf.d/30-frontends.cfg", "maps/hosts.map", "certs/example.com.pem").
 * Значение — содержимое файла (string или Buffer для бинарных, например, certs).
 */
export interface RenderedTree {
  files: Map<string, string | Buffer>;
}

export interface ApplyOptions {
  message: string;
  authorEmail?: string;
  /** Если true — выполнить только validate, без deploy/reload. */
  dryRun?: boolean;
}

export interface NodeApplyResult {
  nodeId: string;
  nodeName: string;
  ok: boolean;
  validateOk: boolean;
  reloadOk: boolean;
  durationMs: number;
  error?: string;
}

export interface ApplyResult {
  jobId: string;
  clusterId: string;
  ok: boolean;
  nodes: NodeApplyResult[];
  configVersionId?: string;
}
