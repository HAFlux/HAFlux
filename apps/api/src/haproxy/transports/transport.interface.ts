import { RenderedTree } from '../types';

/**
 * Транспорт для доставки артефактов рендера на ноду + выполнения команд (validate/reload).
 *
 * - LocalTransport — пишет напрямую в shared volume и exec'ит haproxy через docker.
 * - SshTransport — SFTP + ssh-exec (для удалённых нод).
 */
export interface NodeTransport {
  /** Атомарная запись дерева файлов в data dir на ноде. */
  deploy(tree: RenderedTree): Promise<void>;

  /** Выполнить `haproxy -c -f ...`. Возвращает stdout+stderr; кидает при ненулевом коде. */
  validate(): Promise<{ stdout: string; stderr: string }>;

  /** Reload через mode (CONTAINER | SYSTEMD | SIGNAL | MASTER_CLI). */
  reload(): Promise<void>;

  /** Освободить ресурсы (закрыть SSH сессии и т.п.). */
  close(): Promise<void>;
}
