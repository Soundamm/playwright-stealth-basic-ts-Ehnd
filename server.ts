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
const MAX_BROWSERS = 2; // Aumentar a 2 navegadores
let isShuttingDown = false;

// ✅ FUNCIÓN GETBROWSER CORREGIDA
async function getBrowser(): Promise<Browser> {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }

  // Filtrar navegadores desconectados
  browserPool = browserPool.filter(browser => browser.isConnected());

  // Si no hay navegadores disponibles, crear uno nuevo
  if (browserPool.length === 0) {
    console.log('🚀 Creando nuevo browser...');
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
        '--disable-features=site-per-process'
      ],
      timeout: 45000
    });
    browserPool.push(browser);
    return browser;
  }

  // Buscar un navegador disponible
  for (const browser of browserPool) {
    if (browser.isConnected() && browser.contexts().length < 5) {
      console.log('♻️ Reutilizando browser del pool...');
      return browser;
    }
  }

  // Si todos están ocupados pero no hemos llegado al máximo, crear uno nuevo
  if (browserPool.length < MAX_BROWSERS) {
    console.log('🚀 Pool ocupado, creando browser adicional...');
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
        '--disable-features=VizDisplayCompositor'
      ],
      timeout: 45000
    });
    browserPool.push(browser);
    return browser;
  }

  // Si llegamos aquí, usar el primer navegador disponible
  const browser = browserPool[0];
  if (!browser.isConnected()) {
    browserPool = browserPool.filter(b => b !== browser);
    return getBrowser(); // Recursión para crear uno nuevo
  }

  return browser;
}

// ✅ FUNCIÓN releaseBrowser MEJORADA
async function releaseBrowser(browser: Browser): Promise<void> {
  if (!browser || !browser.isConnected()) return;

  try {
    const contexts = browser.contexts();
    console.log(`🔄 Liberando ${contexts.length} contextos del browser`);
    
    // Cerrar contextos específicos, no el navegador
    for (const context of contexts) {
      if (!context.isClosed()) {
        await context.close();
      }
    }
  } catch (error) {
    console.error('Error liberando contextos:', error);
    // Si hay error, remover el navegador del pool
    browserPool = browserPool.filter(b => b !== browser);
    try {
      await browser.close();
    } catch (closeError) {
      console.error('Error cerrando navegador problemático:', closeError);
    }
  }
}

// Limpieza cada 5 minutos
setInterval(async () => {
  if (browserPool.length > 0 && !isShuttingDown) {
    console.log('🧹 Limpiando pool de navegadores...');
    
    for (let i = browserPool.length - 1; i >= 0; i--) {
      const browser = browserPool[i];
      
      if (!browser.isConnected()) {
        console.log('Removiendo navegador desconectado del pool');
        browserPool.splice(i, 1);
        continue;
      }

      // Cerrar contextos viejos pero mantener navegador
      const contexts = browser.contexts();
      for (const context of contexts) {
        try {
          await context.close();
        } catch (error) {
          console.error('Error cerrando contexto en limpieza:', error);
        }
      }
    }
    
    console.log(`✨ Pool limpiado. Navegadores activos: ${browserPool.length}`);
  }
}, 5 * 60 * 1000);

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

// Health check endpoints
app.get('/', (req, res) => {
  const poolStatus = browserPool.map((browser, index) => ({
    index,
    connected: browser.isConnected(),
    contexts: browser.contexts().length
  }));

  res.json({
    status: 'ok',
    message: 'Playwright Stealth API funcionando',
    timestamp: new Date().toISOString(),
    poolSize: browserPool.length,
    poolStatus,
    endpoints: {
      'POST /final-url': 'Procesa URLs y devuelve información final'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    poolSize: browserPool.length 
  });
});

// ✅ ENDPOINT MEJORADO CON MEJOR MANEJO DE ERRORES
app.post('/final-url', async (req, res) => {
  const startTime = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let browserWasCreated = false;

  try {
    const { url }: { url?: string } = req.body;
    if (!url) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL es requerida' 
      });
    }

    console.log(`🔗 [${new Date().toISOString()}] Procesando URL: ${url}`);
    
    // Validación básica de URL
    try {
      new URL(url);
    } catch (urlError) {
      return res.status(400).json({
        status: 'error',
        message: 'URL inválida',
        originalUrl: url
      });
    }

    browser = await getBrowser();
    console.log(`📊 Browser obtenido. Pool size: ${browserPool.length}, Contextos activos: ${browser.contexts().length}`);

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true
    });

    const page: Page = await context.newPage();
    const redirectChain: string[] = [];

    // Capturar requests en lugar de responses para el chain
    page.on('request', (request) => {
      if (request.resourceType() === 'document') {
        redirectChain.push(request.url());
      }
    });

    const response: Response | null = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 20000, // Aumentar timeout
    });

    const finalUrl: string = page.url();
    const title: string = await page.title().catch(() => 'Sin título');
    const statusCode: number = response?.status() || 0;

    await page.close();

    const processingTime = Date.now() - startTime;
    console.log(`✅ [${new Date().toISOString()}] URL procesada exitosamente: ${finalUrl} (${processingTime}ms)`);

    res.json({
      status: 'success',
      originalUrl: url,
      finalUrl,
      title,
      statusCode,
      redirectCount: Math.max(0, redirectChain.length - 1),
      redirectChain: [...new Set(redirectChain)],
      processingTime: `${processingTime}ms`
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [${new Date().toISOString()}] Error en /final-url:`, error);

    // ✅ MEJOR MANEJO DE ERRORES - No cerrar el navegador completo
    if (context) {
      try {
        await context.close();
        console.log('🔧 Contexto cerrado tras error');
      } catch (contextError) {
        console.error('Error cerrando contexto tras error:', contextError);
      }
    }

    // Solo cerrar navegador si está realmente corrupto
    if (browser && (!browser.isConnected() || error.message.includes('Target page, context or browser has been closed'))) {
      console.log('🚨 Navegador corrupto detectado, cerrando y removiendo del pool');
      browserPool = browserPool.filter(b => b !== browser);
      try {
        await browser.close();
      } catch (browserCloseError) {
        console.error('Error cerrando navegador corrupto:', browserCloseError);
      }
      browser = null; // Prevenir que se libere en finally
    }

    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Error desconocido',
      originalUrl: req.body.url || 'unknown',
      processingTime: `${processingTime}ms`
    });

  } finally {
    // Solo liberar si el navegador no fue cerrado por error
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
