import express from 'express';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page, Response } from 'playwright';

console.log('🚀 Iniciando servidor Playwright...');
console.log('📊 Variables de entorno:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);

chromium.use(StealthPlugin());

let browserPool: Browser[] = [];
const MAX_BROWSERS = 2;
let isShuttingDown = false;

async function createNewBrowser(): Promise<Browser> {
  try {
    const browser: Browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--memory-pressure-off',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=VizDisplayCompositor',
        '--disable-web-security',
        '--disable-features=site-per-process',
      ],
      timeout: 45000,
    });
    browserPool.push(browser);
    console.log(`✅ Browser creado. Pool size: ${browserPool.length}`);
    return browser;
  } catch (error) {
    console.error('❌ Error creando browser:', error);
    throw error;
  }
}

async function getBrowser(): Promise<Browser> {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }

  // Mantener solo browsers conectados
  browserPool = browserPool.filter((browser) => browser.isConnected());

  // Si no hay browsers, crear uno
  if (browserPool.length === 0) {
    console.log('🚀 Creando nuevo browser (pool vacío)...');
    return await createNewBrowser();
  }

  // Reutilizar uno con pocos contextos
  for (const browser of browserPool) {
    if (browser.isConnected() && browser.contexts().length < 3) {
      console.log(`♻️ Reutilizando browser del pool (${browser.contexts().length} contextos)`);
      return browser;
    }
  }

  // Si el pool está ocupado pero aún no al máximo, crear otro
  if (browserPool.length < MAX_BROWSERS) {
    console.log('🆕 Creando browser adicional (pool ocupado)...');
    return await createNewBrowser();
  }

  // Último recurso: devolver el primero (sobrecargado)
  console.log('⚠️ Usando primer browser del pool (sobrecargado)');
  return browserPool[0];
}

// Liberar browser: hoy en día cerramos contextos ociosos, no forzamos cierre
async function releaseBrowser(browser: Browser): Promise<void> {
  if (!browser || !browser.isConnected()) {
    console.log('⚠️ Browser no válido para release');
    return;
  }
  try {
    const contexts = browser.contexts();
    console.log(`🔄 Limpiando ${contexts.length} contextos del browser (solo inactivos)`);
    for (const context of contexts) {
      try {
        // Cerrar solo contextos sin páginas para no interrumpir tráficos activos
        if (context.pages().length === 0) {
          await context.close();
        }
      } catch (contextError) {
        console.log('Context ya estaba cerrado o error al cerrar:', contextError);
      }
    }
    console.log('✅ Browser liberado correctamente');
  } catch (error) {
    console.error('❌ Error liberando browser:', error);
    // Si falló la liberación, quitar del pool y cerrar
    browserPool = browserPool.filter((b) => b !== browser);
    try {
      await browser.close();
      console.log('🗑️ Browser problemático eliminado del pool');
    } catch (closeError) {
      console.error('❌ Error cerrando browser problemático:', closeError);
    }
  }
}

// Limpieza programada: no cerrar contextos en uso, solo desconectados o sin páginas
setInterval(async () => {
  if (browserPool.length > 0 && !isShuttingDown) {
    console.log('🧹 Limpieza programada de pool...');
    for (let i = browserPool.length - 1; i >= 0; i--) {
      const browser = browserPool[i];

      if (!browser.isConnected()) {
        console.log(`🗑️ Removiendo browser desconectado [${i}]`);
        browserPool.splice(i, 1);
        continue;
      }

      try {
        for (const ctx of browser.contexts()) {
          try {
            if (ctx.pages().length === 0) {
              await ctx.close();
            }
          } catch (contextError) {
            console.log('Context error en limpieza:', contextError);
          }
        }
      } catch (error) {
        console.error(`❌ Error en limpieza de browser [${i}]:`, error);
      }
    }
    console.log(`✨ Pool limpiado. Browsers activos: ${browserPool.length}`);
  }
}, 5 * 60 * 1000);

// Señales de proceso
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

process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada en:', promise, 'razón:', reason);
  process.exit(1);
});

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  const poolStatus = browserPool.map((browser, index) => ({
    index,
    connected: browser.isConnected(),
    contexts: browser.contexts().length,
  }));
  res.json({
    status: 'ok',
    message: 'Playwright Stealth API funcionando',
    timestamp: new Date().toISOString(),
    poolSize: browserPool.length,
    poolStatus,
    endpoints: {
      'POST /final-url': 'Procesa URLs y devuelve información final',
    },
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    poolSize: browserPool.length,
  });
});

app.post('/final-url', async (req, res) => {
  const startTime = Date.now();

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let wasBrowserFromPool = false;

  try {
    const { url }: { url?: string } = req.body;
    if (!url) {
      return res.status(400).json({
        status: 'error',
        message: 'URL es requerida',
      });
    }

    // Validación básica de URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        status: 'error',
        message: 'URL inválida',
        originalUrl: url,
      });
    }

    console.log(`🔗 [${new Date().toISOString()}] Procesando URL: ${url}`);

    browser = await getBrowser();
    wasBrowserFromPool = browserPool.includes(browser);
    console.log(
      `📊 Browser obtenido. Pool size: ${browserPool.length}, Contextos: ${browser.contexts().length}`,
    );

    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
    });

    const page: Page = await context.newPage();

    const redirectChain: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') {
        redirectChain.push(request.url());
      }
    });

    const response: Response | null = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000, // aumentado para sitios más lentos
    });

    const finalUrl: string = page.url();
    const title: string = await page.title().catch(() => 'Sin título');
    const statusCode: number = response?.status() || 0;

    await page.close();

    const processingTime = Date.now() - startTime;
    console.log(`✅ [${new Date().toISOString()}] URL procesada: ${finalUrl} (${processingTime}ms)`);

    return res.json({
      status: 'success',
      originalUrl: url,
      finalUrl,
      title,
      statusCode,
      redirectCount: Math.max(0, redirectChain.length - 1),
      redirectChain: [...new Set(redirectChain)],
      processingTime: `${processingTime}ms`,
    });
  } catch (error: unknown) {
    const processingTime = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ [${new Date().toISOString()}] Error procesando ${req.body.url}:`, error);

    // Reintento liviano: si fue cierre de page/contexto y el browser sigue vivo
    if (
      browser &&
      wasBrowserFromPool &&
      browser.isConnected() &&
      (/Target page/i.test(msg) || /context/i.test(msg) || /Page closed/i.test(msg))
    ) {
      try {
        const retryCtx = await browser.newContext({ ignoreHTTPSErrors: true });
        const retryPage = await retryCtx.newPage();
        const resp = await retryPage.goto(req.body.url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        const finalUrl = retryPage.url();
        const title = await retryPage.title().catch(() => 'Sin título');
        const statusCode = resp?.status() || 0;
        await retryPage.close();
        await retryCtx.close().catch(() => {});
        return res.json({
          status: 'success',
          originalUrl: req.body.url,
          finalUrl,
          title,
          statusCode,
          redirectCount: 0, // no reciclamos redirectChain del intento previo
          redirectChain: [],
          processingTime: `${Date.now() - startTime}ms`,
        });
      } catch (retryErr) {
        console.error('🔁 Reintento falló:', retryErr);
      }
    }

    // Expulsar del pool solo si el browser realmente está caído
    const fatal =
      !browser?.isConnected() ||
      /browser has been closed|Browser closed/i.test(msg);

    if (browser && wasBrowserFromPool && fatal) {
      console.log('🚨 Browser realmente caído, removiendo del pool');
      browserPool = browserPool.filter((b) => b !== browser);
      try {
        await browser.close();
      } catch (browserCloseError) {
        console.error('Error cerrando browser caído:', browserCloseError);
      }
      browser = null;
    }

    return res.status(500).json({
      status: 'error',
      message: msg || 'Error desconocido',
      originalUrl: req.body.url || 'unknown',
      processingTime: `${processingTime}ms`,
    });
  } finally {
    // Cerrar contexto siempre, incluso en éxito
    if (context) {
      await context.close().catch(() => {});
    }
    // Liberar browser si sigue en el pool
    if (browser && browserPool.includes(browser)) {
      await releaseBrowser(browser);
    }
  }
});

const PORT: number = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Playwright corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📊 Pool configurado para ${MAX_BROWSERS} navegadores máximo`);
});
