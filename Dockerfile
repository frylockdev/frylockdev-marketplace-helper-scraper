# Playwright image with browser deps (Chromium)
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Chromium for Playwright
RUN npx playwright install chromium

# App
COPY src/ src/

# App listens on PORT (Dokploy sets it) or 3001
ENV PORT=3001
EXPOSE 3001

# Healthcheck for Dokploy/orchestrator (uses PORT so it works when platform overrides it)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["sh", "-c", "curl -sf http://localhost:${PORT:-3001}/health || exit 1"]

CMD ["node", "src/index.js"]
