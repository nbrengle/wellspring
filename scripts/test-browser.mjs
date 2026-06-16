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

    // --- CHARACTER CREATOR SMOKE TEST ---
    // Drive the interactive build surface. The panels/pickers below are where a
    // render-time crash (e.g. an undefined handler) actually surfaces — initial
    // page load alone does NOT exercise them. Any pageerror/console error raised
    // during these interactions is caught by the final assertion below.
    console.log("Testing Character Creator: pick archetype, open panels...");
    // Pick the first archetype to enter the builder.
    await page.click('.b-archetype-card, .b-lin-card, button.b-pick-archetype', { timeout: 5000 }).catch(async () => {
      // Fallback: click the first archetype-looking button.
      await page.locator('button').filter({ hasText: /Fighter|Cleric|Rogue|Mage|Artisan|Sword/i }).first().click();
    });
    await page.waitForTimeout(300);

    // Open the Lineage panel and pick a lineage — the exact path that regressed
    // (LineagePanel referenced an undefined handler → whole tree unmounted).
    const lineageOpener = page.locator('button').filter({ hasText: /lineage/i }).first();
    if (await lineageOpener.count()) {
      await lineageOpener.click();
      await page.waitForSelector('.b-lin-card, .b-lin-list', { timeout: 5000 });
      const firstLineage = page.locator('.b-lin-card').first();
      if (await firstLineage.count()) {
        await firstLineage.click();
        await page.waitForTimeout(300);
        // Picking a lineage must render its challenges/advantages, not a blank panel.
        const rows = await page.locator('.b-lin-row').count();
        if (rows === 0) {
          throw new Error("Lineage panel rendered no challenge/advantage rows after picking a lineage (panel crashed?)");
        }
      }
      // Close the panel.
      await page.locator('.b-picker-x').first().click().catch(() => {});
      await page.waitForTimeout(200);
    }

    // Open an "Add" picker (skill/perk) — exercises PickerOverlay.
    const addBtn = page.locator('button').filter({ hasText: /^\s*\+/ }).first();
    if (await addBtn.count()) {
      await addBtn.click().catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }

    // Fail loudly if ANY error fired during the creator interactions above.
    if (errors.length > 0) {
      console.error("FAIL: errors during Character Creator interaction:");
      errors.forEach(e => console.error(e.message || e));
      process.exit(1);
    }

    // --- RULES EXPLORER TESTS ---
    console.log("Testing Rules Explorer mode switching...");
    await page.click('button:has-text("Rules Explorer")');
    
    // Check that we switched to Rules Explorer
    await page.waitForSelector('.b-explorer');
    const expSubTitle = await page.textContent('.b-topbar-sub');
    if (!expSubTitle || !expSubTitle.includes("Rules Explorer")) {
      throw new Error(`Expected top bar sub title to switch to "Rules Explorer", got "${expSubTitle}"`);
    }

    // Check default loaded detail title is "Introduction"
    const detailTitle = await page.textContent('.b-explorer-detail-title');
    if (!detailTitle || !detailTitle.includes("Introduction")) {
      throw new Error(`Expected default detail title to be "Introduction", got "${detailTitle}"`);
    }

    // Perform a search for a known rule or concept, e.g. "Armor"
    console.log("Testing search and filtering...");
    await page.fill('.b-explorer-search', 'Armor');
    await page.waitForTimeout(200); // Wait for filtering

    // Click the search result row for "Armor Points"
    await page.click('.b-explorer-row-name:has-text("Armor Points")');
    
    // Verify the detail title updated to "Armor Points"
    const newDetailTitle = await page.textContent('.b-explorer-detail-title');
    if (!newDetailTitle || !newDetailTitle.includes("Armor Points")) {
      throw new Error(`Expected detail title to update to "Armor Points", got "${newDetailTitle}"`);
    }

    // Check if there is a concept/ability link in the description block to follow recursively
    const conceptBtn = await page.locator('.b-concept:has-text("Life Points")').first();
    if (await conceptBtn.isVisible()) {
      console.log("Testing concept link navigation...");
      await conceptBtn.click();
      
      // Verify detail title updated to "Life Points"
      const linkDetailTitle = await page.textContent('.b-explorer-detail-title');
      if (!linkDetailTitle || !linkDetailTitle.includes("Life Points")) {
        throw new Error(`Expected detail title to update to "Life Points" after clicking concept link, got "${linkDetailTitle}"`);
      }

      // Verify back button is visible and click it
      const backBtn = await page.locator('.b-detail-back');
      if (await backBtn.isVisible()) {
        console.log("Testing back navigation...");
        await backBtn.click();
        
        // Verify detail title goes back to "Armor Points"
        const backDetailTitle = await page.textContent('.b-explorer-detail-title');
        if (!backDetailTitle || !backDetailTitle.includes("Armor Points")) {
          throw new Error(`Expected detail title to return to "Armor Points" after back click, got "${backDetailTitle}"`);
        }
      }
    }

    // Switch back to creator
    console.log("Testing switching back to Character Creator...");
    await page.click('button:has-text("Character Creator")');
    // The creator shows the build sheet (a character was picked above), so wait on
    // the identity rail / sheet container rather than the "pick a character" title.
    await page.waitForSelector('.b-id-value, .b-sheet-title, .b-build', { timeout: 5000 });

    // Final gate: NO page/console error may have fired at any point in the run.
    // This is the check that would have caught the lineage-panel crash.
    if (errors.length > 0) {
      console.error("FAIL: page/console errors detected during the session:");
      errors.forEach(e => console.error(e.message || e));
      process.exit(1);
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
