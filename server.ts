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
const MAX_BROWSERS = 2; // Incrementar para rate limiting
let isShuttingDown = false;

// ✅ FUNCIÓN GETBROWSER COMPLETAMENTE CORREGIDA
async function getBrowser(): Promise<Browser> {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }

  // Limpiar browsers desconectados del pool
  browserPool = browserPool.filter(browser => browser.isConnected());
  
  // Si no hay browsers, crear uno nuevo
  if (browserPool.length === 0) {
    console.log('🚀 Creando nuevo browser (pool vacío)...');
    return await createNewBrowser();
  }
  
  // Buscar browser con pocos contextos activos
  for (const browser of browserPool) {
    if (browser.isConnected() && browser.contexts().length < 3) {
      console.log(`♻️ Reutilizando browser del pool (${browser.contexts().length} contextos)`);
      return browser;
    }
  }
  
  // Si todos están ocupados pero no hemos llegado al máximo, crear nuevo
  if (browserPool.length < MAX_BROWSERS) {
    console.log('🆕 Creando browser adicional (pool ocupado)...');
    return await createNewBrowser();
  }
  
  // Como último recurso, usar el primer browser del pool
  console.log('⚠️ Usando primer browser del pool (sobrecargado)');
  return browserPool[0];
}

// ✅ FUNCIÓN AUXILIAR PARA CREAR BROWSERS
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
        '--disable-features=site-per-process'
      ],
      timeout: 45000
    });
    
    browserPool.push(browser);
    console.log(`✅ Browser creado. Pool size: ${browserPool.length}`);
    return browser;
    
  } catch (error) {
    console.error('❌ Error creando browser:', error);
    throw error;
  }
}

// ✅ FUNCIÓN RELEASEBROWSER MEJORADA
async function releaseBrowser(browser: Browser): Promise<void> {
  if (!browser || !browser.isConnected()) {
    console.log('⚠️ Browser no válido para release');
    return;
  }

  try {
    const contexts = browser.contexts();
    console.log(`🔄 Limpiando ${contexts.length} contextos del browser`);
    
    // Cerrar solo contextos, mantener browser vivo
    for (const context of contexts) {
      if (!context.isClosed()) {
        await context.close();
      }
    }
    
    console.log('✅ Browser liberado correctamente');
    
  } catch (error) {
    console.error('❌ Error liberando browser:', error);
    
    // Si hay error grave, remover browser del pool
    browserPool = browserPool.filter(b => b !== browser);
    try {
      await browser.close();
      console.log('🗑️ Browser problemático eliminado del pool');
    } catch (closeError) {
      console.error('❌ Error cerrando browser problemático:', closeError);
    }
  }
}

// Limpieza cada 5 minutos
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
      
      // Limpiar contextos viejos
      try {
        const contexts = browser.contexts();
        for (const context of contexts) {
          await context.close();
        }
      } catch (error) {
        console.error(`❌ Error en limpieza de browser [${i}]:`, error);
      }
    }
    
    console.log(`✨ Pool limpiado. Browsers activos: ${browserPool.length}`);
  }
}, 5 * 60 * 1000);

// Manejo de cierre graceful
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

// ✅ ENDPOINT COMPLETAMENTE REESCRITO
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
        message: 'URL es requerida' 
      });
    }

    // Validar URL
    try {
      new URL(url);
    } catch (urlError) {
      return res.status(400).json({
        status: 'error',
        message: 'URL inválida',
        originalUrl: url
      });
    }

    console.log(`🔗 [${new Date().toISOString()}] Procesando URL: ${url}`);
    
    // Obtener browser del pool
    browser = await getBrowser();
    wasBrowserFromPool = browserPool.includes(browser);
    
    console.log(`📊 Browser obtenido. Pool size: ${browserPool.length}, Contextos: ${browser.contexts().length}`);

    // Crear contexto
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true
    });

    const page: Page = await context.newPage();
    const redirectChain: string[] = [];

    // Capturar requests para redirecciones
    page.on('request', (request) => {
      if (request.resourceType() === 'document') {
        redirectChain.push(request.url());
      }
    });

    // Navegar
    const response: Response | null = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const finalUrl: string = page.url();
    const title: string = await page.title().catch(() => 'Sin título');
    const statusCode: number = response?.status() || 0;

    // Cerrar página
    await page.close();

    const processingTime = Date.now() - startTime;
    console.log(`✅ [${new Date().toISOString()}] URL procesada: ${finalUrl} (${processingTime}ms)`);

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
    console.error(`❌ [${new Date().toISOString()}] Error procesando ${req.body.url}:`, error);

    // ✅ MANEJO DE ERRORES MEJORADO - NO cerrar browser del pool
    if (context) {
      try {
        await context.close();
      } catch (contextError) {
        console.error('Error cerrando contexto tras error:', contextError);
      }
    }

    // Solo remover browser del pool si está realmente corrupto
    if (browser && wasBrowserFromPool && (!browser.isConnected() || 
        error.message.includes('Target page, context or browser has been closed'))) {
      console.log('🚨 Browser corrupto detectado, removiendo del pool');
      browserPool = browserPool.filter(b => b !== browser);
      try {
        await browser.close();
      } catch (browserCloseError) {
        console.error('Error cerrando browser corrupto:', browserCloseError);
      }
      browser = null; // Prevenir release en finally
    }

    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Error desconocido',
      originalUrl: req.body.url || 'unknown',
      processingTime: `${processingTime}ms`
    });

  } finally {
    // Liberar browser solo si sigue en el pool
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
