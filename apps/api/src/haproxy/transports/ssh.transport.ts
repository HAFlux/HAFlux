import path from 'node:path';
import { Logger } from '@nestjs/common';
import { Node } from '@prisma/client';
import { Client, type SFTPWrapper } from 'ssh2';
import { RenderedTree } from '../types';
import { NodeTransport } from './transport.interface';

const CONNECT_TIMEOUT_MS = 10_000;
const EXEC_TIMEOUT_MS = 20_000;

/**
 * Транспорт для удалённых нод по SSH/SFTP (ssh2).
 *
 * Ключ панели — приватный RSA-ключ из БД (SshKeysService); публичную часть
 * оператор кладёт в authorized_keys пользователя на ноде.
 *
 * Деплой пишет файлы in-place (truncate): haproxy читает файлы только в момент
 * reload, а reload выполняется после validate, поэтому пофайловая запись безопасна.
 */
export class SshTransport implements NodeTransport {
  private readonly logger: Logger;
  private client: Client | null = null;

  constructor(
    private readonly node: Node,
    private readonly privateKeyPem: string,
  ) {
    this.logger = new Logger(`SshTransport[${node.name}]`);
    if (!this.node.sshHost) {
      throw new Error(`Node ${node.name}: sshHost is required for SSH transport`);
    }
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client
        .on('ready', () => resolve())
        .on('error', (err) => reject(new Error(`SSH connect failed: ${err.message}`)))
        .connect({
          host: this.node.sshHost ?? undefined,
          port: this.node.sshPort ?? 22,
          username: this.node.sshUser ?? 'root',
          privateKey: this.privateKeyPem,
          readyTimeout: CONNECT_TIMEOUT_MS,
        });
    });
    this.client = client;
    return client;
  }

  private async sftp(): Promise<SFTPWrapper> {
    const client = await this.connect();
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
    });
  }

  /** Выполнить команду; кидает при ненулевом exit code. */
  async exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
    const client = await this.connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`SSH exec timeout: ${cmd}`)),
        EXEC_TIMEOUT_MS,
      );
      client.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        stream
          .on('data', (d: Buffer) => {
            stdout += d.toString();
          })
          .on('close', (code: number) => {
            clearTimeout(timer);
            if (code === 0) resolve({ stdout, stderr });
            else
              reject(
                new Error(`"${cmd}" exited with ${code}: ${(stderr || stdout).slice(0, 2000)}`),
              );
          });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
      });
    });
  }

  async deploy(tree: RenderedTree): Promise<void> {
    const root = this.node.haproxyDataDir;
    const sftp = await this.sftp();

    // mkdir -p всех нужных директорий одним exec'ом — быстрее, чем sftp mkdir по одной
    const dirs = new Set<string>([root]);
    for (const relPath of tree.files.keys()) {
      dirs.add(path.posix.dirname(path.posix.join(root, relPath)));
    }
    await this.exec(`mkdir -p ${[...dirs].map((d) => `'${d}'`).join(' ')}`);

    for (const [relPath, content] of tree.files) {
      const abs = path.posix.join(root, relPath);
      const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
      await new Promise<void>((resolve, reject) => {
        const stream = sftp.createWriteStream(abs, { mode: 0o644 });
        stream.on('error', (err: Error) => reject(new Error(`SFTP write ${abs}: ${err.message}`)));
        stream.on('close', () => resolve());
        stream.end(buf);
      });
    }
    this.logger.log(`deployed ${tree.files.size} files to ${this.node.sshHost}:${root}`);
  }

  async validate(): Promise<{ stdout: string; stderr: string }> {
    const cfg = path.posix.join(this.node.haproxyDataDir, 'haproxy.cfg');
    return this.exec(`haproxy -c -f '${cfg}'`);
  }

  async reload(): Promise<void> {
    // Поля ноды валидируются на CRUD (без shell-метасимволов), плюс кавычки здесь.
    const target = this.node.reloadTarget;
    switch (this.node.reloadMode) {
      case 'CONTAINER':
        await this.exec(`docker kill -s USR2 '${target || 'haproxy-balancer'}'`);
        return;
      case 'SYSTEMD':
        await this.exec(`systemctl reload '${target || 'haproxy'}'`);
        return;
      case 'SIGNAL': {
        const pidfile = target || '/var/run/haproxy.pid';
        await this.exec(`kill -USR2 $(cat '${pidfile}')`);
        return;
      }
      case 'MASTER_CLI': {
        const sock = target || '/var/run/haproxy/admin.sock';
        await this.exec(`echo reload | socat - UNIX-CONNECT:'${sock}'`);
        return;
      }
    }
  }

  async close(): Promise<void> {
    this.client?.end();
    this.client = null;
  }
}
