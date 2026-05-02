# haproxy-data/

Сюда панель пишет конфиг HAProxy и его модули. Контейнер `haproxy` монтирует это дерево read‑only.

```
haproxy.cfg          # global + defaults (rendered)
conf.d/              # frontends, backends, listen, peers, resolvers, ...
certs/               # *.pem (cert + key, как ожидает crt-list)
maps/                # *.map
acl/                 # *.lst (IP/prefix lists)
errors/              # *.http (errorfile)
lua/                 # *.lua
spoe/                # *.cfg (SPOE agents — например ModSecurity)
```

Файлы здесь **не редактируются вручную** — следующее «Apply» в UI перезапишет их. Если нужно срочно обойти панель, отредактируйте напрямую и сделайте `docker kill -s USR2 haproxy-balancer`, но потом всё равно сначала зафиксируйте изменения в UI.
