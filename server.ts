import express from 'express';
import { chromium, Browser, BrowserContext, Page, APIResponse } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

let browserPool: Browser[] = [];
const MAX_BROWSERS = 1;
let isShuttingDown = false;

async function getBrowser(): Promise<Browser> {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }

  browserPool = browserPool.filter(browser => browser.isConnected());

  if (browserPool.length === 0) {
    console.log('🚀 Creando nuevo browser...');
    const browser: Browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--single-process',
        '--memory-pressure-off',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=VizDisplayCompositor',
      ],
      timeout: 50000
    });
    browserPool.push(browser);
    return browser;
  }

  const browser = browserPool[0];
  if (!browser.isConnected()) {
    console.log('Browser desconectado, eliminando y creando nuevo...');
    browserPool = browserPool.filter(b => b !== browser);
    await browser.close().catch(() => {});
    return getBrowser();
  }

  console.log('♻️ Reutilizando browser del pool...');
  return browser;
}

async function releaseBrowser(browser: Browser): Promise<void> {
  if (browser && browser.isConnected()) {
    try {
      const contexts: BrowserContext[] = browser.contexts();
      for (const context of contexts) {
        await context.close();
      }
      console.log('Contextos cerrados, navegador mantenido en pool');
    } catch (error) {
      console.error('Error cerrando contextos:', error);
    }
  }
}

setInterval(async () => {
  if (browserPool.length > 0 && !isShuttingDown) {
    console.log('🧹 Reiniciando pool de navegadores...');
    const browsersToClose = browserPool.splice(0);
    for (const browser of browsersToClose) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error cerrando browser:', e);
      }
    }
    console.log('✨ Pool reiniciado');
  }
}, 10 * 60 * 1000);

process.on('SIGTERM', async () => {
  console.log('🛑 Iniciando cierre graceful...');
  isShuttingDown = true;
  const browsersToClose = browserPool.splice(0);
  for (const browser of browsersToClose) {
    try {
      await browser.close();
    } catch (e) {
      console.error('Error en cierre:', e);
    }
  }
  process.exit(0);
});

const app = express();
app.use(express.json());

app.post('/final-url', async (req, res) => {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const { url }: { url?: string } = req.body;
    if (!url) {
      return res.status(400).json({ status: 'error', message: 'URL es requerida' });
    }

    browser = await getBrowser();

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page: Page = await context.newPage();

    const redirectChain: string[] = [];

    page.on('response', (response: APIResponse) => {
      redirectChain.push(response.url());
    });

    const response: APIResponse | null = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const finalUrl: string = page.url();
    const title: string = await page.title();
    const statusCode: number = response?.status() || 0;

    await page.close();

    res.json({
      status: 'success',
      originalUrl: url,
      finalUrl,
      title,
      statusCode,
      redirectCount: redirectChain.length - 1,
      redirectChain: [...new Set(redirectChain)],
    });
  } catch (error) {
    console.error('❌ Error en /final-url:', error);

    if (browser) {
      try {
        await browser.close();
        browserPool = browserPool.filter(b => b !== browser);
      } catch {}
    }

    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Error desconocido',
      originalUrl: req.body.url || 'unknown',
    });
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (e) {
        console.error('Error cerrando contexto:', e);
      }
    }
    if (browser) {
      await releaseBrowser(browser);
    }
  }
});

const PORT: number = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Playwright corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📊 Pool configurado para ${MAX_BROWSERS} navegadores máximo`);
});
