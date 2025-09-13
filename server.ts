import express from 'express';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Configurar stealth plugin
chromium.use(StealthPlugin());

const app = express();

app.use(express.json());

// Endpoint de prueba
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Playwright Stealth API funcionando en Railway',
    endpoints: ['/playwright']
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
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
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
