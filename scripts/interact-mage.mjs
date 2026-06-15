import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  // Go to home page
  await page.goto('http://localhost:5173/wellspring/', { waitUntil: 'networkidle' });

  // Click on "Start blank"
  console.log("Clicking 'Start blank'...");
  await page.click('button:has-text("Start blank")');
  await page.waitForSelector('.b-overlay');

  // Find and click Mage in class picker list
  console.log("Selecting Mage class...");
  const classes = page.locator('.b-picker-row');
  const classesCount = await classes.count();
  let mageRow = null;
  for (let i = 0; i < classesCount; i++) {
    const text = await classes.nth(i).textContent();
    if (text.includes("Mage")) {
      mageRow = classes.nth(i);
      break;
    }
  }
  if (!mageRow) throw new Error("Mage class row not found in picker");
  await mageRow.click();
  await page.waitForTimeout(200);

  console.log("Confirming class choice...");
  await page.click('.b-read-choose');
  await page.waitForSelector('.b-overlay', { state: 'detached' });
  await page.waitForTimeout(500);

  // Now the lineage overlay opens automatically because lineage is null.
  // Press Escape to dismiss the Lineage overlay.
  console.log("Dismissing automatically-opened lineage overlay...");
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Print skills list items after Mage added from scratch
  console.log("\nSkills list after picking Mage from scratch:");
  const skills = page.locator('.b-section:has-text("Skills") .b-row');
  const skillsCount = await skills.count();
  for (let i = 0; i < skillsCount; i++) {
    const text = await skills.nth(i).textContent();
    const html = await skills.nth(i).innerHTML();
    console.log(`  Skill ${i}: "${text.trim().replace(/\n/g, ' ')}" -> HTML: ${html.trim()}`);
  }

  // Click "+ Add a skill" to purchase a third Bookcaster
  console.log("\nClicking '+ Add a skill' button...");
  await page.click('.b-section:has-text("Skills") .b-section-add');
  await page.waitForSelector('.b-overlay');

  console.log("Selecting 'Bookcaster' in picker...");
  const pickerItems = page.locator('.b-picker-row');
  const pickerCount = await pickerItems.count();
  let bookcasterItem = null;
  for (let i = 0; i < pickerCount; i++) {
    const text = await pickerItems.nth(i).textContent();
    if (text.includes("Bookcaster") && !text.includes("Expertise")) {
      bookcasterItem = pickerItems.nth(i);
      break;
    }
  }
  if (!bookcasterItem) throw new Error("Bookcaster skill not found in picker");
  await bookcasterItem.click();
  await page.waitForTimeout(200);

  console.log("Confirming skill choice...");
  await page.click('.b-read-choose');
  await page.waitForSelector('.b-overlay', { state: 'detached' });
  await page.waitForTimeout(500);

  // Print skills list after adding purchased Bookcaster
  console.log("\nSkills list after purchasing third Bookcaster (unparameterized):");
  const skills2 = page.locator('.b-section:has-text("Skills") .b-row');
  const skillsCount2 = await skills2.count();
  for (let i = 0; i < skillsCount2; i++) {
    const text = await skills2.nth(i).textContent();
    console.log(`  Skill ${i}: "${text.trim().replace(/\n/g, ' ')}"`);
  }

  // Click on the purchased unparameterized Bookcaster to inspect and set its parameter
  console.log("\nClicking on purchased Bookcaster to edit its parameter...");
  // It is the last skill in the list (index skillsCount2 - 1)
  const newBookcasterRow = skills2.nth(skillsCount2 - 1).locator('.b-row-name');
  await newBookcasterRow.click();
  await page.waitForSelector('.b-parameter-input');

  console.log("Typing 'Identify' in parameter input...");
  await page.fill('.b-parameter-input', 'Identify');
  await page.waitForSelector('.b-combobox-option');
  await page.click('.b-combobox-option:has-text("Identify")');
  await page.waitForTimeout(500);

  // Print final skills list after parameterization
  console.log("\nFinal Skills list after setting parameter to Identify:");
  const finalSkills = page.locator('.b-section:has-text("Skills") .b-row');
  const finalSkillsCount = await finalSkills.count();
  for (let i = 0; i < finalSkillsCount; i++) {
    const text = await finalSkills.nth(i).textContent();
    const html = await finalSkills.nth(i).innerHTML();
    console.log(`  Skill ${i}: "${text.trim().replace(/\n/g, ' ')}" -> HTML: ${html.trim()}`);
  }

  await browser.close();
}

run().catch(console.error);
