import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Node } from '@prisma/client';
import type { RenderedTree } from '../types';
import type { NodeTransport } from './transport.interface';

const execAsync = promisify(exec);

/**
 * Транспорт для нод, которые живут на той же машине, что и api (через shared docker volume).
 *
 * Запись — атомарная через временную директорию + rename.
 * Validate — `docker exec <reloadTarget> haproxy -c -f ...`.
 * Reload  — `docker kill -s USR2 <reloadTarget>` (или master CLI socket в волюме).
 */
export class LocalTransport implements NodeTransport {
  constructor(private readonly node: Node) {}

  async deploy(tree: RenderedTree): Promise<void> {
    const root = this.node.haproxyDataDir;
    const stagingRoot = `${root}.staging-${process.pid}-${Date.now()}`;

    await fs.mkdir(stagingRoot, { recursive: true });

    for (const [relPath, content] of tree.files) {
      const abs = path.join(stagingRoot, relPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, typeof content === 'string' ? 'utf8' : undefined);
    }

    // Атомарный swap: rename staging → live (через старый-бекап).
    const backup = `${root}.bak-${Date.now()}`;
    try {
      await fs.access(root);
      await fs.rename(root, backup);
    } catch {
      // root не существовал — ок
    }
    await fs.rename(stagingRoot, root);
    await fs.rm(backup, { recursive: true, force: true });
  }

  async validate(): Promise<{ stdout: string; stderr: string }> {
    const target = this.node.reloadTarget ?? 'haproxy-balancer';
    const cmd = [
      'docker exec',
      target,
      'haproxy -c',
      '-f /usr/local/etc/haproxy/haproxy.cfg',
      '-f /usr/local/etc/haproxy/conf.d/',
    ].join(' ');

    return execAsync(cmd, { timeout: 15_000 });
  }

  async reload(): Promise<void> {
    const target = this.node.reloadTarget ?? 'haproxy-balancer';
    switch (this.node.reloadMode) {
      case 'CONTAINER':
        await execAsync(`docker kill -s USR2 ${target}`, { timeout: 10_000 });
        return;
      case 'SYSTEMD':
        await execAsync(`systemctl reload ${target || 'haproxy'}`, { timeout: 10_000 });
        return;
      case 'SIGNAL': {
        const pidfile = target || '/var/run/haproxy.pid';
        await execAsync(`kill -USR2 $(cat ${pidfile})`, { timeout: 10_000 });
        return;
      }
      case 'MASTER_CLI': {
        const sock = target || '/var/run/haproxy/admin.sock';
        await execAsync(`echo "reload" | socat - UNIX-CONNECT:${sock}`, { timeout: 10_000 });
        return;
      }
    }
  }

  async close(): Promise<void> {
    // нет ресурсов для закрытия
  }
}
