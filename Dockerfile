# Panel wizard/API — el código del kit se monta en /kit (ver docker-compose.yml).
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /kit

ENV ORCHESTRATOR_IN_DOCKER=1 \
    CONFIGURE_HOST=0.0.0.0 \
    CONFIGURE_PORT=8765

# Fallback si alguien arranca la imagen sin montar el repo (compose siempre monta /kit).
COPY scripts/run-wizard.sh /kit/scripts/run-wizard.sh
RUN chmod +x /kit/scripts/run-wizard.sh

CMD ["bash", "scripts/run-wizard.sh"]
