import { Injectable } from '@nestjs/common';
import { Node } from '@prisma/client';
import { SshKeysService } from '../ssh-keys.service';
import { LocalTransport } from './local.transport';
import { SshTransport } from './ssh.transport';
import { NodeTransport } from './transport.interface';

@Injectable()
export class TransportFactory {
  constructor(private readonly sshKeys: SshKeysService) {}

  async forNode(node: Node): Promise<NodeTransport> {
    if (node.transport === 'LOCAL') {
      return new LocalTransport(node);
    }
    // SSH: приватный ключ панели расшифровывается envelope'ом (CryptoService)
    const privateKeyPem = await this.sshKeys.privateKeyPem();
    return new SshTransport(node, privateKeyPem);
  }
}
