import express from 'express';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

let browserPool: any[] = [];
const MAX_BROWSERS = 1;
let isShuttingDown = false;

async function getBrowser() {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }

  // Filtrar navegadores desconectados
  browserPool = browserPool.filter(browser => browser.isConnected());

  if (browserPool.length === 0) {
    console.log('🚀 Creando nuevo browser...');
    const browser = await chromium.launch({
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
    // Eliminar navegador desconectado
    browserPool = browserPool.filter(b => b !== browser);
    await browser.close().catch(() => {});
    // Crear uno nuevo
    return getBrowser();
  }

  console.log('♻️ Reutilizando browser del pool...');
  return browser;
}

async function releaseBrowser(browser: any) {
  if (browser && browser.isConnected()) {
    try {
      const contexts = browser.contexts();
      for (const context of contexts) {
        await context.close();
      }
      console.log('Contextos cerrados, navegador mantenido en pool');
    } catch (error) {
      console.error('Error cerrando contextos:', error);
    }
  }
}

// Limpieza periódica
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

// Cierre graceful
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
  let browser = null;
  let context = null;

  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ status: 'error', message: 'URL es requerida' });
    }

    browser = await getBrowser();

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    const redirectChain: string[] = [];

    page.on('response', (response) => {
      redirectChain.push(response.url());
    });

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const finalUrl = page.url();
    const title = await page.title();
    const statusCode = response?.status() || 0;

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
        browserPool = browserPool.filter((b) => b !== browser);
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

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Playwright corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📊 Pool configurado para ${MAX_BROWSERS} navegadores máximo`);
});
