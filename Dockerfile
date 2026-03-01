FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Install Chromium browsers for Playwright
RUN npx playwright install chromium

COPY src/ src/

EXPOSE 3001

CMD ["node", "src/index.js"]
