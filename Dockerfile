# Strata — the verification layer for medical AI.
# Self-contained: standard-library only, no build deps, no model downloads.
#
#   docker build -t strata .
#   docker run -p 8600:8600 -v strata-data:/data -e STRATA_API_KEYS=sk_live_change_me strata
#
# On-prem friendly: Strata reads only public literature, so no patient data (PHI) ever
# leaves your network. The persistent store lives in the /data volume.
FROM python:3.12-slim

LABEL org.opencontainers.image.title="Strata" \
      org.opencontainers.image.description="The verification layer for medical AI" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY strata ./strata
RUN pip install --no-cache-dir .

# where living reviews + monitored claims persist
ENV STRATA_HOME=/data
VOLUME ["/data"]

EXPOSE 8600
# Seed demo data on first boot so the console/demo are populated; drop --no-demo? keep it.
CMD ["strata", "serve", "--host", "0.0.0.0", "--port", "8600"]
