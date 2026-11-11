# Quadlets (Phase 5)

Later, `infra/compose.yaml` becomes Quadlet units (`~/.config/containers/systemd/*.container`)
so Postgres and Ollama start at boot with health checks, without `podman-compose`.
Until then, `loginctl enable-linger $USER` keeps the compose containers up after logout.
