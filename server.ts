import express from 'express';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Response, Route } from 'playwright'; // ✅ AGREGAR ESTA LÍNEA

// Configurar stealth plugin
chromium.use(StealthPlugin());

// =======================================
// POOL DE BROWSERS OPTIMIZADO
// =======================================
let browserPool: any[] = [];
const MAX_BROWSERS = 2;
let isShuttingDown = false;

// Argumentos optimizados para memoria y performance
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--single-process',
  '--memory-pressure-off',
  '--max_old_space_size=1500',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=VizDisplayCompositor',
  '--disable-plugins',
  '--disable-web-security',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--disable-background-networking'
];

async function getBrowser() {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }
  
  if (browserPool.length === 0) {
    console.log('🚀 Creando nuevo browser optimizado...');
    const browser = await chromium.launch({
      headless: true,
      args: BROWSER_ARGS,
      timeout: 25000,
      chromiumSandbox: false
    });
    return browser;
  }
  
  console.log('♻️ Reutilizando browser del pool...');
  return browserPool.shift();
}

async function releaseBrowser(browser: any) {
  if (isShuttingDown || !browser) {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error('Error cerrando browser en shutdown:', error);
      }
    }
    return;
  }
  
  // Limpiar contextos antes de devolver al pool
  try {
    const contexts = browser.contexts();
    for (const context of contexts) {
      await context.close();
    }
  } catch (error) {
    console.error('Error limpiando contextos:', error);
  }
  
  if (browserPool.length < MAX_BROWSERS) {
    browserPool.push(browser);
    console.log(`📦 Browser devuelto al pool (${browserPool.length}/${MAX_BROWSERS})`);
  } else {
    try {
      await browser.close();
      console.log('🗑️ Browser cerrado (pool lleno)');
    } catch (error) {
      console.error('Error cerrando browser extra:', error);
    }
  }
}

// Limpieza más frecuente del pool para mejor gestión de memoria
setInterval(async () => {
  if (browserPool.length > 0 && !isShuttingDown) {
    console.log('🧹 Limpiando pool de navegadores...');
    const browsersToClose = browserPool.splice(0);
    
    for (const browser of browsersToClose) {
      try {
        await browser.close();
      } catch (error) {
        console.error('Error cerrando browser en limpieza:', error);
      }
    }
    console.log('✨ Pool limpiado');
  }
}, 15 * 60 * 1000);

// Monitoreo de memoria cada 5 minutos
setInterval(() => {
  const memUsage = process.memoryUsage();
  console.log(`📊 Memoria: RSS=${Math.round(memUsage.rss/1024/1024)}MB, Heap=${Math.round(memUsage.heapUsed/1024/1024)}MB, Pool=${browserPool.length} browsers`);
}, 5 * 60 * 1000);

// Manejo de cierre graceful mejorado
const gracefulShutdown = async (signal: string) => {
  console.log(`🛑 Recibida señal ${signal}, iniciando cierre graceful...`);
  isShuttingDown = true;
  
  const browsersToClose = browserPool.splice(0);
  console.log(`🔄 Cerrando ${browsersToClose.length} browsers del pool...`);
  
  await Promise.allSettled(
    browsersToClose.map(browser => browser.close())
  );
  
  console.log('✅ Cierre completado');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// =======================================
// EXPRESS APP
// =======================================
const app = express();
app.use(express.json({ limit: '10mb' }));

// Endpoint de prueba actualizado
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Playwright Stealth API optimizada funcionando en Railway',
    endpoints: {
      'POST /final-url': 'Resuelve URL final siguiendo redirecciones'
    },
    stats: {
      poolSize: browserPool.length,
      maxBrowsers: MAX_BROWSERS,
      memoryUsage: `${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`
    }
  });
});

// ENDPOINT ÚNICO OPTIMIZADO
app.post('/final-url', async (req, res) => {
  let browser = null;
  let context = null;
  const startTime = Date.now();
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL es requerida' 
      });
    }

    console.log(`🔗 Siguiendo redirecciones para: ${url}`);
    
    browser = await getBrowser();
    
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid'
    });

    const page = await context.newPage();
    
    // Array para guardar el chain de redirecciones
    const redirectChain: string[] = [];
    
    // ✅ CORRECCIÓN: Tipo explícito para response
    page.on('response', (response: Response) => {
      const responseUrl = response.url();
      if (!redirectChain.includes(responseUrl)) {
        redirectChain.push(responseUrl);
      }
    });
    
    // ✅ CORRECCIÓN: Tipo explícito para route
    await page.route('**/*', (route: Route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Navegar con timeout optimizado
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 12000
    });
    
    const finalUrl = page.url();
    const title = await page.title();
    const statusCode = response?.status() || 0;
    const processingTime = Date.now() - startTime;
    
    // Cerrar solo el contexto para reutilizar el browser
    await context.close();
    context = null;
    
    res.json({
      status: 'success',
      originalUrl: url,
      finalUrl: finalUrl,
      title: title,
      statusCode: statusCode,
      redirectCount: redirectChain.length - 1,
      redirectChain: [...new Set(redirectChain)],
      processingTime: `${processingTime}ms`,
      poolStats: {
        browsersInPool: browserPool.length,
        maxBrowsers: MAX_BROWSERS
      }
    });
    
  } catch (error) {
    console.error('Error en final-url:', error);
    
    // Cleanup en caso de error
    if (context) {
      try {
        await context.close();
      } catch (e) {
        console.error('Error cerrando contexto:', e);
      }
    }
    
    res.status(500).json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Error desconocido al seguir redirecciones',
      originalUrl: req.body.url || 'unknown',
      processingTime: `${Date.now() - startTime}ms`
    });
  } finally {
    if (browser) {
      await releaseBrowser(browser);
    }
  }
});

// Middleware de manejo de errores global
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Error no manejado:', err);
  res.status(500).json({
    status: 'error',
    message: 'Error interno del servidor'
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Playwright optimizado corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📊 Pool configurado para ${MAX_BROWSERS} browsers máximo`);
});
