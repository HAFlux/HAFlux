import { Injectable } from '@nestjs/common';
import type { Node } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { LocalTransport } from './local.transport';
import { SshTransport } from './ssh.transport';
import type { NodeTransport } from './transport.interface';

@Injectable()
export class TransportFactory {
  constructor(private readonly prisma: PrismaService) {}

  async forNode(node: Node): Promise<NodeTransport> {
    if (node.transport === 'LOCAL') {
      return new LocalTransport(node);
    }
    // SSH: достаём приватный ключ панели (TODO: расшифровка через ENCRYPTION_KEY)
    const key = await this.prisma.sshKey.findFirst();
    if (!key) {
      throw new Error('SSH key not configured. Settings → SSH key → Generate.');
    }
    const privateKeyPem = Buffer.from(key.encryptedPrivKey).toString('utf8'); // TODO: decrypt envelope
    return new SshTransport(node, privateKeyPem);
  }
}
