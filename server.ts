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


// Endpoint mejorado para seguir redirecciones de campañas de marketing
app.post('/resolve-url', async (req, res) => {
  try {
    const { url, userAgent, timeout = 30000 } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL es requerida' 
      });
    }

    console.log(`🔗 Siguiendo redirecciones para URL de marketing: ${url}`);
    
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });

    const context = await browser.newContext({
      userAgent: userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      // Simular headers reales de email click
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'no-cache'
      }
    });

    const page = await context.newPage();
    
    // Array para el chain completo de redirecciones
    const redirectChain: Array<{url: string, status: number, timestamp: number}> = [];
    let finalError = null;
    
    // Interceptar todas las respuestas
    page.on('response', response => {
      redirectChain.push({
        url: response.url(),
        status: response.status(),
        timestamp: Date.now()
      });
    });

    // Manejar errores de página
    page.on('pageerror', error => {
      console.log('Page error:', error.message);
    });

    let finalUrl: string;
    let title: string;
    let statusCode: number;

    try {
      // Navegar con timeout extendido
      const response = await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });
      
      // Esperar un poco más para redirecciones JavaScript
      await page.waitForTimeout(3000);
      
      finalUrl = page.url();
      title = await page.title();
      statusCode = response?.status() || 0;
      
      // Si la URL final es muy similar a la original, intentar hacer click en links
      if (finalUrl === url || finalUrl.includes('beehiiv.com') || finalUrl.includes('mail.')) {
        console.log('🔄 Intentando buscar redirecciones automáticas...');
        
        // Buscar meta refresh
        const metaRefresh = await page.$eval('meta[http-equiv="refresh"]', 
          el => el.getAttribute('content')).catch(() => null);
        
        if (metaRefresh) {
          const match = metaRefresh.match(/url=(.+)/i);
          if (match) {
            console.log('🔄 Found meta refresh:', match[1]);
            await page.goto(match[1], { waitUntil: 'domcontentloaded' });
            finalUrl = page.url();
            title = await page.title();
          }
        }
        
        // Buscar scripts de redirección
        const jsRedirect = await page.evaluate(() => {
          // Buscar window.location en scripts
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const script of scripts) {
            if (script.textContent?.includes('window.location')) {
              const match = script.textContent.match(/window\.location(?:\.href)?\s*=\s*['"`]([^'"`]+)['"`]/);
              if (match) return match[1];
            }
          }
          return null;
        });
        
        if (jsRedirect) {
          console.log('🔄 Found JS redirect:', jsRedirect);
          await page.goto(jsRedirect, { waitUntil: 'domcontentloaded' });
          finalUrl = page.url();
          title = await page.title();
        }
      }
      
    } catch (error) {
      finalError = error instanceof Error ? error.message : 'Error desconocido';
      finalUrl = redirectChain.length > 0 ? redirectChain[redirectChain.length - 1].url : url;
      title = 'Error loading page';
      statusCode = 0;
    }
    
    await browser.close();
    
    // Analizar cadena de redirecciones
    const uniqueUrls = [...new Set(redirectChain.map(r => r.url))];
    const redirectCount = uniqueUrls.length - 1;
    
    // Determinar si realmente se resolvió
    const wasResolved = finalUrl !== url && 
                       !finalUrl.includes('beehiiv.com') && 
                       !finalUrl.includes('mail.') &&
                       !finalUrl.includes('link.') &&
                       !finalUrl.includes('click.') &&
                       !finalUrl.includes('tracking.');
    
    res.json({
      status: finalError ? 'warning' : 'success',
      originalUrl: url,
      finalUrl: finalUrl,
      wasResolved: wasResolved,
      title: title,
      statusCode: statusCode,
      redirectCount: redirectCount,
      redirectChain: uniqueUrls,
      error: finalError,
      processingTime: Date.now() - redirectChain[0]?.timestamp || 0
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
        message: 'Error desconocido al procesar URL de marketing',
        originalUrl: req.body.url || 'unknown'
      });
    }
  }
});
