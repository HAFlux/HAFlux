import path from 'node:path';
import { Logger } from '@nestjs/common';
import type { Node } from '@prisma/client';
import type { RenderedTree } from '../types';
import type { NodeTransport } from './transport.interface';

/**
 * Транспорт для удалённых нод по SSH/SFTP.
 *
 * Реализация через `node-ssh` (обёртка над ssh2). Ключ панели — приватный ключ,
 * расшифрованный из БД (модель `SshKey`); публичная часть кладётся на ноду в
 * authorized_keys через Ansible bootstrap (см. deploy/ansible/roles/haproxy_node).
 *
 * MVP: оставляем заглушку с понятным контрактом. Полная реализация — task v0.1+.
 */
export class SshTransport implements NodeTransport {
  private readonly logger: Logger;

  constructor(
    private readonly node: Node,
    private readonly privateKeyPem: string,
  ) {
    this.logger = new Logger(`SshTransport[${node.name}]`);
    if (!this.node.sshHost) {
      throw new Error(`Node ${node.name}: sshHost is required for SSH transport`);
    }
  }

  async deploy(_tree: RenderedTree): Promise<void> {
    // План:
    // 1. SFTP подключение (host=sshHost, port=sshPort, user=sshUser, privateKey=privateKeyPem)
    // 2. mkdir <haproxyDataDir>.staging-<ts>; залить файлы
    // 3. ssh-exec: validate во временной директории
    // 4. mv старого root в .bak, mv staging → root
    // 5. rm -rf .bak
    this.logger.warn('SshTransport.deploy is not implemented yet — task v0.1');
    throw new Error('SshTransport not implemented yet');
  }

  async validate(): Promise<{ stdout: string; stderr: string }> {
    const dir = this.node.haproxyDataDir;
    const cmd = `haproxy -c -f ${path.join(dir, 'haproxy.cfg')} -f ${path.join(dir, 'conf.d')}`;
    this.logger.debug(`would execute on ${this.node.sshHost}: ${cmd}`);
    throw new Error('SshTransport not implemented yet');
  }

  async reload(): Promise<void> {
    this.logger.debug(`would reload via ${this.node.reloadMode} on ${this.node.sshHost}`);
    throw new Error('SshTransport not implemented yet');
  }

  async close(): Promise<void> {
    // закроем SSH-сессию когда реализуем
  }
}
