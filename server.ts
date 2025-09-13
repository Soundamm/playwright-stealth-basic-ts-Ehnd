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
    const screenshot = await page.screenshot({ encoding: 'base64' });
    
    await browser.close();
    
    res.json({
      status: 'success',
      title,
      url,
      screenshot: `data:image/png;base64,${screenshot}`
    });
    
  } catch (error) {
    console.error('Error en Playwright:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Playwright corriendo en http://0.0.0.0:${PORT}`);
});
