import { createServer } from 'vite';
import { chromium } from 'playwright';

async function run() {
  let server;
  let url = 'http://localhost:5173/wellspring/';
  
  // Try checking if port 5173 is already running.
  // If not, spin up a dev server programmatically.
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    console.log("Found running dev server, reusing...");
  } catch {
    console.log("No running dev server found. Spinning up a temporary dev server...");
    server = await createServer({
      server: { port: 5173 }
    });
    await server.listen();
    url = `http://localhost:5173/wellspring/`;
  }
  
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const errors = [];
  page.on('pageerror', (err) => {
    errors.push(err);
  });
  
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(new Error(`Console error: ${msg.text()}`));
    }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // Give it a brief moment to catch any async errors
    await page.waitForTimeout(500);
    
    if (errors.length > 0) {
      console.error("FAIL: Browser page errors or console errors detected:");
      errors.forEach(e => console.error(e.message || e));
      process.exit(1);
    }
    
    const titleText = await page.textContent('.b-sheet-title');
    if (!titleText || !titleText.includes("Pick a starting character")) {
      throw new Error(`Expected title to include "Pick a starting character", got "${titleText}"`);
    }
    
    console.log("✓ Browser integration test passed successfully!");
  } catch (err) {
    console.error("FAIL: Browser test encountered an error:", err);
    process.exit(1);
  } finally {
    await browser.close();
    if (server) {
      await server.close();
    }
  }
}

run();
