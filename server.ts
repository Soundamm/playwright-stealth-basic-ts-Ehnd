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

async function getBrowser(): Promise<Browser> {
  if (isShuttingDown) {
    throw new Error('Server is shutting down');
  }

  browserPool = browserPool.filter(browser => browser.isConnected());
  
  if (browserPool.length === 0) {
    console.log('🚀 Creando nuevo browser (pool vacío)...');
    return await createNewBrowser();
  }
  
  for (const browser of browserPool) {
    if (browser.isConnected() && browser.contexts().length < 3) {
      console.log(`♻️ Reutilizando browser del pool (${browser.contexts().length} contextos)`);
      return browser;
    }
  }
  
  if (browserPool.length < MAX_BROWSERS) {
    console.log('🆕 Creando browser adicional (pool ocupado)...');
    return await createNewBrowser();
  }
  
  console.log('⚠️ Usando primer browser del pool (sobrecargado)');
  return browserPool[0];
}

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
