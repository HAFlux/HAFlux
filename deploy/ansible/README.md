# Ansible deployment

Быстрое развёртывание HAFlux: control‑plane + произвольное число HAProxy нод.

## Что разворачивается

- **control_plane** (один или несколько хостов) — Postgres, Redis, api (NestJS), web (nginx + SPA), HAProxy балансировщик панели.
- **haproxy_nodes** — только контейнер `haproxy:3.1.17-alpine`. Никакого custom‑агента: панель управляет нодой по SSH (SFTP для файлов + ssh‑exec для validate/reload).

## Подготовка

```bash
ansible-galaxy install -r deploy/ansible/requirements.yml
cp deploy/ansible/inventory/hosts.example.ini deploy/ansible/inventory/hosts.ini
$EDITOR deploy/ansible/inventory/hosts.ini
```

## Полный rollout

```bash
ansible-playbook -i deploy/ansible/inventory/hosts.ini deploy/ansible/site.yml
```

`site.yml` подключает два плейбука:

1. `playbooks/control-plane.yml` — деплой панели.
2. `playbooks/haproxy-node.yml` — деплой HAProxy на каждую ноду из группы `haproxy_nodes`.

## Только control‑plane или только ноды

```bash
ansible-playbook -i ... deploy/ansible/playbooks/control-plane.yml
ansible-playbook -i ... deploy/ansible/playbooks/haproxy-node.yml
```

## SSH ключ панели

Чтобы панель могла доставлять конфиги на удалённые ноды, нужен публичный SSH‑ключ. Два варианта:

1. **После запуска control‑plane** — открыть UI → Settings → SSH key → Generate. Скопировать публичный ключ. Положить в `group_vars/all.yml` как `haflux_panel_pubkey` и прогнать плейбук `haproxy-node.yml` — он добавит ключ в `authorized_keys` пользователя `haflux` на каждой ноде.
2. **До запуска** — сгенерировать локально (`ssh-keygen -t ed25519 -f ./haflux_id`), передать pubkey через `--extra-vars`, импортировать приватный ключ в панель в Settings → SSH key → Import.

```bash
ansible-playbook -i deploy/ansible/inventory/hosts.ini \
  deploy/ansible/playbooks/haproxy-node.yml \
  --extra-vars "haflux_panel_pubkey='ssh-ed25519 AAAA... haflux'"
```

## Что роли делают

| Роль | Что |
|---|---|
| `common` | apt update, базовые пакеты, ufw (опц.), таймзона |
| `docker` | репо Docker CE, docker engine + compose plugin, python docker SDK |
| `control_plane` | клонирует HAFlux, генерирует секреты (идемпотентно), рендерит compose.yml + .env, поднимает стек |
| `haproxy_node` | пользователь `haflux`, authorized_keys, директории `/etc/haproxy/{conf.d,certs,maps,acl,errors,lua,spoe}`, контейнер `haproxy-balancer` (host network, ulimits, master CLI socket), фаервол |

## После деплоя

В UI панели заведите ноду:

- transport=SSH, sshHost=`<inventory hostname>`, sshUser=`haflux`
- haproxyDataDir=`/etc/haproxy`, reloadMode=CONTAINER, reloadTarget=`haproxy-balancer`

И нажмите **Apply** в кластере — панель отрендерит конфиг, зальёт по SFTP, валидирует через `docker exec`, отправит SIGUSR2 для seamless reload.
