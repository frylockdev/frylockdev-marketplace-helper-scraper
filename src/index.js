/**
 * Playwright scraper sidecar for marketplace-helper.
 * Exposes a simple HTTP API consumed by the Go worker engine.
 *
 * POST /scrape  { "url": "https://www.wildberries.ru/catalog/..." }
 * → { "products": [{ "name": "...", "price": 3299, "url": "...", "in_stock": true }] }
 */

const express = require('express');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(express.json());

// Keep a single browser instance to avoid per-request startup cost
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browser;
}

/**
 * Scrapes a Wildberries search/category page and returns all product cards.
 * WB renders product cards via JS, so we need a real browser.
 */
async function scrapeWildberries(url) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ru-RU',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for product cards to appear
    await page.waitForSelector('.product-card', { timeout: 15000 }).catch(() => {
      // If no cards appear, WB may have blocked us or there are no results
    });

    // Scroll to load lazy-loaded items
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1500);

    const products = await page.evaluate(() => {
      const cards = document.querySelectorAll('.product-card');
      const results = [];

      cards.forEach((card) => {
        try {
          // WB product card selectors (as of 2024 — may need updating)
          const nameEl = card.querySelector('.product-card__name');
          const priceEl = card.querySelector('.price__lower-price');
          const linkEl = card.querySelector('a.product-card__link');
          const outOfStockEl = card.querySelector('.sold-out-product');

          if (!priceEl || !linkEl) return;

          const rawPrice = priceEl.textContent
            .replace(/\s/g, '')
            .replace('₽', '')
            .replace(',', '.')
            .split('.')[0];

          const price = parseInt(rawPrice, 10);
          if (isNaN(price)) return;

          const href = linkEl.getAttribute('href');
          const productUrl = href.startsWith('http')
            ? href
            : `https://www.wildberries.ru${href}`;

          results.push({
            name: nameEl ? nameEl.textContent.trim() : 'Товар на WB',
            price,
            url: productUrl,
            in_stock: !outOfStockEl,
          });
        } catch (_) {
          // skip malformed cards
        }
      });

      return results;
    });

    return products;
  } finally {
    await context.close();
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  console.log(`[scraper] scraping: ${url}`);

  try {
    const products = await scrapeWildberries(url);
    console.log(`[scraper] found ${products.length} products`);
    res.json({ products });
  } catch (err) {
    console.error(`[scraper] error scraping ${url}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Startup ───────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`[scraper] listening on :${PORT}`);
  // Warm up the browser on startup
  try {
    await getBrowser();
    console.log('[scraper] browser ready');
  } catch (err) {
    console.error('[scraper] browser warmup failed:', err.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[scraper] shutting down...');
  if (browser) await browser.close();
  process.exit(0);
});
