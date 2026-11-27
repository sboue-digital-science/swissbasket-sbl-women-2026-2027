// Re-draws preview.png (the 1200x630 link-preview image) from the current dashboard.
// Run after the weekly data update. Needs: npm i playwright && npx playwright install --with-deps chromium
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); const f = join(process.cwd(), p === '/' ? 'index.html' : p);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); }
  catch { res.writeHead(404); res.end(); }
}).listen(8791);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'light' });
await page.goto('http://localhost:8791/', { waitUntil: 'networkidle' });
await page.waitForSelector('#race g.rr');
// headline + standings race only: hide the filters, share button, intro line and race subtitle
await page.addStyleTag({ content: '.fbar,.shb,header p,#rcS{display:none!important}' });
await page.waitForTimeout(800);
await page.screenshot({ path: 'preview.png' });
await browser.close(); server.close();
console.log('preview.png updated');
