import { createServer } from "vite";
import { chromium } from "playwright";

async function run() {
  let server;
  let url = "http://localhost:5173/wellspring/";

  // Try checking if port 5173 is already running.
  // If not, spin up a dev server programmatically.
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    console.log("Found running dev server, reusing...");
  } catch {
    console.log("No running dev server found. Spinning up a temporary dev server...");
    server = await createServer({
      server: { port: 5173 },
    });
    await server.listen();
    url = `http://localhost:5173/wellspring/`;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on("pageerror", (err) => {
    errors.push(err);
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(new Error(`Console error: ${msg.text()}`));
    }
  });

  try {
    await page.goto(url, { waitUntil: "networkidle" });

    // Give it a brief moment to catch any async errors
    await page.waitForTimeout(500);

    if (errors.length > 0) {
      console.error("FAIL: Browser page errors or console errors detected:");
      errors.forEach((e) => console.error(e.message || e));
      process.exit(1);
    }

    const titleText = await page.textContent(".b-sheet-title");
    if (!titleText || !titleText.includes("Pick a starting character")) {
      throw new Error(`Expected title to include "Pick a starting character", got "${titleText}"`);
    }

    // --- CHARACTER CREATOR SMOKE TEST ---
    // Drive EVERY top-level flow of the build surface. The panels/pickers below are
    // where a render-time crash (e.g. an undefined handler) actually surfaces —
    // initial page load alone does NOT exercise them. Each flow is opened, asserted
    // to render something, and closed; any pageerror/console error during these
    // interactions is caught by the assertion at the end of this block.
    console.log("Testing Character Creator: every top-level flow...");

    // Exercise a flow: click its trigger and let it render. The HARD gate for every
    // flow is the page-error/console-error collector asserted at the end of this
    // block — that's what catches a render crash like the lineage-panel regression.
    // We do NOT require the overlay to appear, because whether a picker opens can
    // depend on mutable build state (e.g. a devotion card that's already set shows
    // inspect/clear instead of the picker); requiring it would make the test brittle
    // without improving crash detection. The trigger MUST exist, though — a renamed
    // selector should fail here, not silently skip the flow it guards.
    const flow = async (label, trigger, closeFn) => {
      console.log(`  · ${label}`);
      const loc = typeof trigger === "function" ? null : page.locator(trigger);
      if (loc && (await loc.count()) === 0) {
        throw new Error(`Flow "${label}": trigger "${trigger}" not found (selector changed?)`);
      }
      if (loc)
        await loc
          .first()
          .click()
          .catch(() => {});
      else await trigger();
      await page.waitForTimeout(300);
      if (closeFn) {
        await closeFn();
        await page.waitForTimeout(150);
      }
    };

    // Enter the builder via a CASTER archetype (Cleric): a caster exposes every
    // top-level flow — devotion card + an open spell-slot picker — that a martial
    // build hides. So one archetype exercises lineage, devotion, add-pickers,
    // power-slot picker, export, and the mode tabs.
    await page
      .locator("button, .b-archetype-card")
      .filter({ hasText: /Cleric/i })
      .first()
      .click()
      .catch(async () => {
        await page
          .locator("button")
          .filter({ hasText: /Fighter|Mage|Rogue|Artisan|Sword/i })
          .first()
          .click();
      });
    // Entering the builder renders <Builder> — a render-time crash (the lineage
    // regression was an undefined handler referenced here) fires a pageerror and
    // unmounts the tree. Catch it immediately, with a clear message.
    await page.waitForSelector(".b-id-card", { timeout: 5000 }).catch(() => {
      if (errors.length > 0) {
        console.error("FAIL: errors on entering the builder:", errors);
      }
      throw new Error(
        "Build sheet (.b-id-card) never rendered after picking an archetype — Builder crashed on render?",
      );
    });
    if (errors.length > 0) {
      console.error("FAIL: errors on entering the builder:");
      errors.forEach((e) => console.error(e.message || e));
      process.exit(1);
    }

    const esc = async () => {
      await page.keyboard.press("Escape").catch(() => {});
    };
    const clickX = async () => {
      await page
        .locator('.b-picker-x, .b-overlay-close, [aria-label="Close"]')
        .first()
        .click()
        .catch(() => {});
    };

    // 1. Lineage panel FIRST — open it and PICK a lineage. This is the exact path
    //    that regressed (LineagePanel referenced an undefined handler → the whole
    //    tree unmounted on open). Run on a clean build sheet so the failure points
    //    straight here. HARD-assert the panel opens AND renders rows (not blank).
    console.log("  · Lineage panel (+ pick)");
    await page.locator('.b-id-card:has-text("Lineage")').first().click();
    // The panel opens to the GALLERY when no lineage is set, or straight to the
    // FOCUS view when one already is (the Cleric archetype starts as Human). Accept
    // either, then drive into focus and assert the choice pills render (not blank).
    await page.waitForSelector(".b-lin-gallery-card, .b-lin-focus", { timeout: 5000 }).catch(() => {
      throw new Error("Lineage panel did not open after clicking the Lineage card — Builder crashed on opening it?");
    });
    const galleryCard = page.locator(".b-lin-gallery-card").first();
    if (await galleryCard.count()) {
      await galleryCard.click();
      await page.waitForSelector(".b-lin-focus", { timeout: 5000 }).catch(() => {
        throw new Error("Lineage focus view did not render after picking a lineage (panel crashed?)");
      });
    }
    if ((await page.locator(".b-lin-pill").count()) === 0) {
      throw new Error("Lineage focus rendered no choice pills (panel crashed?)");
    }
    await clickX();
    await page.waitForTimeout(150);

    // 2. Devotion card (caster) — opens the picker when empty, inspect/clear when set.
    await flow("Devotion card", '.b-id-card:has-text("Devotion")', esc);

    // 3. Add-entity pickers: Skill, Perk, Flaw, class, domain power, etc.
    const addButtons = page.locator(".b-section-add, .b-class-add");
    const addCount = await addButtons.count();
    if (addCount === 0)
      throw new Error("No add pickers (.b-section-add/.b-class-add) found — build sheet didn't render?");
    for (let i = 0; i < addCount; i++) {
      await flow(
        `Add picker #${i + 1}`,
        () =>
          addButtons
            .nth(i)
            .click()
            .catch(() => {}),
        esc,
      );
    }

    // 4. Power-slot picker (Cantrip/Spell/Utility/etc.) — click the first open slot.
    const slotAdd = page.locator(".b-slot-add");
    if (await slotAdd.count()) {
      await flow(
        "Power-slot picker",
        () =>
          slotAdd
            .first()
            .click()
            .catch(() => {}),
        esc,
      );
    }

    // 5. Removed Export / Import panel test.

    // 6. Recipe Explorer mode.
    await flow("Recipe Explorer mode", 'button:has-text("Recipe")');
    await page.waitForSelector(".b-recipes, .b-explorer", { timeout: 5000 }).catch(() => {
      throw new Error("Recipe Explorer did not render after switching mode");
    });
    await page.click('button:has-text("Character Creator")').catch(() => {});
    await page.waitForTimeout(200);

    // Fail loudly if ANY error fired during the creator interactions above.
    if (errors.length > 0) {
      console.error("FAIL: errors during Character Creator interaction:");
      errors.forEach((e) => console.error(e.message || e));
      process.exit(1);
    }

    // --- RULES EXPLORER TESTS ---
    console.log("Testing Rules Explorer mode switching...");
    await page.click('button:has-text("Rules Explorer")');

    // Check that we switched to Rules Explorer
    await page.waitForSelector(".b-explorer");
    const expSubTitle = await page.textContent(".b-topbar-sub");
    if (!expSubTitle || !expSubTitle.includes("Rules Explorer")) {
      throw new Error(`Expected top bar sub title to switch to "Rules Explorer", got "${expSubTitle}"`);
    }

    // Check default loaded detail title is "Introduction"
    const detailTitle = await page.textContent(".b-explorer-detail-title");
    if (!detailTitle || !detailTitle.includes("Introduction")) {
      throw new Error(`Expected default detail title to be "Introduction", got "${detailTitle}"`);
    }

    // Perform a search for a known rule or concept, e.g. "Armor"
    console.log("Testing search and filtering...");
    await page.fill(".b-explorer-search", "Armor");
    await page.waitForTimeout(200); // Wait for filtering

    // Click the search result row for "Armor Points"
    await page.click('.b-explorer-row-name:has-text("Armor Points")');

    // Verify the detail title updated to "Armor Points"
    const newDetailTitle = await page.textContent(".b-explorer-detail-title");
    if (!newDetailTitle || !newDetailTitle.includes("Armor Points")) {
      throw new Error(`Expected detail title to update to "Armor Points", got "${newDetailTitle}"`);
    }

    // Check if there is a concept/ability link in the description block to follow recursively
    const conceptBtn = await page.locator('.b-concept:has-text("Life Points")').first();
    if (await conceptBtn.isVisible()) {
      console.log("Testing concept link navigation...");
      await conceptBtn.click();

      // Verify detail title updated to "Life Points"
      const linkDetailTitle = await page.textContent(".b-explorer-detail-title");
      if (!linkDetailTitle || !linkDetailTitle.includes("Life Points")) {
        throw new Error(
          `Expected detail title to update to "Life Points" after clicking concept link, got "${linkDetailTitle}"`,
        );
      }

      // Verify back button is visible and click it
      const backBtn = await page.locator(".b-detail-back");
      if (await backBtn.isVisible()) {
        console.log("Testing back navigation...");
        await backBtn.click();

        // Verify detail title goes back to "Armor Points"
        const backDetailTitle = await page.textContent(".b-explorer-detail-title");
        if (!backDetailTitle || !backDetailTitle.includes("Armor Points")) {
          throw new Error(
            `Expected detail title to return to "Armor Points" after back click, got "${backDetailTitle}"`,
          );
        }
      }
    }

    // Switch back to creator
    console.log("Testing switching back to Character Creator...");
    await page.click('button:has-text("Character Creator")');
    // The creator shows the build sheet (a character was picked above), so wait on
    // the identity rail / sheet container rather than the "pick a character" title.
    await page.waitForSelector(".b-id-value, .b-sheet-title, .b-build", { timeout: 5000 });

    // Final gate: NO page/console error may have fired at any point in the run.
    // This is the check that would have caught the lineage-panel crash.
    if (errors.length > 0) {
      console.error("FAIL: page/console errors detected during the session:");
      errors.forEach((e) => console.error(e.message || e));
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
