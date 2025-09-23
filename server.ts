import express from 'express';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Configurar stealth plugin
chromium.use(StealthPlugin());

// =======================================
// POOL DE BROWSERS - AGREGAR AQUÍ
// =======================================
let browserPool: any[] = [];
const MAX_BROWSERS = 2; // Limitar a 2 navegadores simultáneos
let isShuttingDown = false;

async function getBrowser() {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }
  
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
        '--max_old_space_size=512',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      timeout: 30000
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

// Limpieza periódica del pool
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
}, 30 * 60 * 1000); // Cada 30 minutos

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  console.log('🛑 Iniciando cierre graceful...');
  isShuttingDown = true;
  
  const browsersToClose = browserPool.splice(0);
  for (const browser of browsersToClose) {
    try {
      await browser.close();
    } catch (error) {
      console.error('Error en cierre graceful:', error);
    }
  }
  
  process.exit(0);
});
// =======================================
// FIN POOL DE BROWSERS
// =======================================

const app = express();

app.use(express.json());

// Endpoint de prueba
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Playwright Stealth API funcionando en Railway',
    endpoints: {
      'POST /playwright': 'Captura screenshot y título de una página',
      'POST /resolve-url': 'Resuelve URL final (simplificado)'
    }
  });
});

// Endpoint Playwright
app.post('/playwright', async (req, res) => {
  try {
    console.log('🚀 Iniciando test de Playwright...');
    
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-plugins',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--single-process', // CLAVE: Evita crear múltiples procesos
        '--memory-pressure-off'
  ],
  timeout: 30000 // Timeout más corto
});

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });

    const page = await context.newPage();
    
    // Test básico - puedes modificar la URL desde el request
    const url = req.body.url || 'https://bot.sannysoft.com/';
    await page.goto(url, { waitUntil: 'load' });
    
    const title = await page.title();
    
    // ✅ Corrección 1: Usar screenshot() sin encoding y convertir a base64
    const screenshotBuffer = await page.screenshot();
    const screenshotBase64 = screenshotBuffer.toString('base64');
    
    await browser.close();
    
    res.json({
      status: 'success',
      title,
      url,
      screenshot: `data:image/png;base64,${screenshotBase64}`
    });
    
  } catch (error) {
    console.error('Error en Playwright:', error);
    
    if (error instanceof Error) {
      res.status(500).json({ 
        status: 'error', 
        message: error.message 
      });
    } else {
      res.status(500).json({ 
        status: 'error', 
        message: 'Error desconocido ocurrió' 
      });
    }
  }
});

// Endpoint para seguir redirecciones hasta la URL final
app.post('/final-url', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL es requerida' 
      });
    }

    console.log(`🔗 Siguiendo redirecciones para: ${url}`);
    
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    // Array para guardar el chain de redirecciones
    const redirectChain: string[] = [];
    
    // Escuchar todas las respuestas para capturar redirecciones
    page.on('response', response => {
      redirectChain.push(response.url());
    });
    
    // Navegar y seguir todas las redirecciones
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    const finalUrl = page.url();
    const title = await page.title();
    const statusCode = response?.status() || 0;
    
    await browser.close();
    
    res.json({
      status: 'success',
      originalUrl: url,
      finalUrl: finalUrl,
      title: title,
      statusCode: statusCode,
      redirectCount: redirectChain.length - 1,
      redirectChain: [...new Set(redirectChain)] // Eliminar duplicados
    });
    
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ 
        status: 'error', 
        message: error.message,
        originalUrl: req.body.url || 'unknown'
      });
    } else {
      res.status(500).json({ 
        status: 'error', 
        message: 'Error desconocido al seguir redirecciones',
        originalUrl: req.body.url || 'unknown'
      });
    }
  }
});



// ✅ Corrección 2: Convertir PORT a number
const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Playwright corriendo en http://0.0.0.0:${PORT}`);
});

app.post('/final-url', async (req, res) => {
  let browser = null;
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({
        status: 'error',
        message: 'URL es requerida'
      });
    }

    browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    const page = await context.newPage();
    
    // Tu lógica existente aquí...
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000 // Reducir timeout
    });
    
    const finalUrl = page.url();
    const title = await page.title();
    
    // Cerrar solo el contexto, no el navegador
    await context.close();
    
    res.json({
      status: 'success',
      originalUrl: url,
      finalUrl: finalUrl,
      title: title,
      statusCode: response?.status() || 0
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Error desconocido',
      originalUrl: req.body.url || 'unknown'
    });
  } finally {
    if (browser) {
      await releaseBrowser(browser);
    }
  }
});
