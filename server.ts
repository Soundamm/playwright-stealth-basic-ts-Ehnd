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


app.post('/resolve-url', async (req, res) => {
  try {
    const { url, userAgent, timeout = 30000 } = req.body;
    
    // ✅ Validación inicial robusta
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL válida es requerida' 
      });
    }

    const cleanUrl = url.trim();
    console.log(`🔗 Procesando URL: ${cleanUrl}`);
    
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
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    const page = await context.newPage();
    
    const redirectChain: Array<{url: string, status: number, timestamp: number}> = [];
    let finalError = null;
    
    // ✅ Manejo seguro de respuestas
    page.on('response', response => {
      try {
        const responseUrl = response.url();
        const responseStatus = response.status();
        if (responseUrl && typeof responseUrl === 'string') {
          redirectChain.push({
            url: responseUrl,
            status: responseStatus || 0,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.log('Error capturando respuesta:', error);
      }
    });

    // ✅ Manejo robusto de errores de página
    page.on('pageerror', error => {
      console.log('Page error capturado:', error?.message || 'Error desconocido');
      finalError = `Page error: ${error?.message || 'Error de JavaScript en la página'}`;
    });

    let finalUrl: string;
    let title: string;
    let statusCode: number;

    try {
      const response = await page.goto(cleanUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: timeout
      });
      
      await page.waitForTimeout(3000);
      
      finalUrl = page.url();
      title = await page.title();
      statusCode = response?.status() || 0;
      
      // ✅ Detección segura de redirecciones automáticas
      if (finalUrl === cleanUrl || (finalUrl && finalUrl.toLowerCase().includes('beehiiv.com')) || 
          (finalUrl && (finalUrl.toLowerCase().includes('mail.') || finalUrl.toLowerCase().includes('link.')))) {
        
        console.log('🔄 Buscando redirecciones adicionales...');
        
        // ✅ Meta refresh seguro
        try {
          const metaRefresh = await page.evaluate(() => {
            const metaEl = document.querySelector('meta[http-equiv="refresh"]');
            return metaEl?.getAttribute('content') || null;
          });
          
          if (metaRefresh && typeof metaRefresh === 'string') {
            const match = metaRefresh.toLowerCase().match(/url=(.+)/i);
            if (match && match[1]) {
              console.log('🔄 Meta refresh encontrado:', match[1]);
              await page.goto(match[1], { waitUntil: 'domcontentloaded' });
              finalUrl = page.url();
              title = await page.title();
            }
          }
        } catch (metaError) {
          console.log('Error procesando meta refresh:', metaError);
        }
        
        // ✅ JavaScript redirect seguro
        try {
          const jsRedirect = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const script of scripts) {
              const content = script.textContent;
              if (content && typeof content === 'string' && content.includes('window.location')) {
                const match = content.match(/window\.location(?:\.href)?\s*=\s*['"`]([^'"`]+)['"`]/);
                if (match && match[1]) return match[1];
              }
            }
            return null;
          });
          
          if (jsRedirect && typeof jsRedirect === 'string') {
            console.log('🔄 JS redirect encontrado:', jsRedirect);
            await page.goto(jsRedirect, { waitUntil: 'domcontentloaded' });
            finalUrl = page.url();
            title = await page.title();
          }
        } catch (jsError) {
          console.log('Error procesando JS redirect:', jsError);
        }
      }
      
    } catch (error) {
      finalError = error instanceof Error ? error.message : 'Error de navegación';
      finalUrl = redirectChain.length > 0 ? redirectChain[redirectChain.length - 1].url : cleanUrl;
      title = 'Error loading page';
      statusCode = 0;
    }
    
    await browser.close();
    
    // ✅ Análisis seguro de URLs
    const uniqueUrls = [...new Set(redirectChain.map(r => r.url))];
    const redirectCount = Math.max(0, uniqueUrls.length - 1);
    
    // ✅ Detección segura de resolución
    const wasResolved = finalUrl !== cleanUrl && 
                       finalUrl && 
                       !finalUrl.toLowerCase().includes('beehiiv.com') && 
                       !finalUrl.toLowerCase().includes('mail.') &&
                       !finalUrl.toLowerCase().includes('link.') &&
                       !finalUrl.toLowerCase().includes('click.') &&
                       !finalUrl.toLowerCase().includes('tracking.');
    
    res.json({
      status: finalError ? 'warning' : 'success',
      originalUrl: cleanUrl,
      finalUrl: finalUrl || cleanUrl,
      wasResolved: wasResolved,
      title: title || 'Sin título',
      statusCode: statusCode,
      redirectCount: redirectCount,
      redirectChain: uniqueUrls,
      error: finalError,
      processingTime: redirectChain.length > 0 ? (Date.now() - redirectChain[0].timestamp) : 0
    });
    
  } catch (error) {
    console.error('❌ Error general:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Error desconocido',
      originalUrl: req.body?.url || 'unknown'
    });
  }
});
