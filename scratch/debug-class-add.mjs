import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.goto('http://localhost:5173/wellspring/', { waitUntil: 'networkidle' });

  // Click on "Start blank"
  console.log("Clicking 'Start blank'...");
  await page.click('button:has-text("Start blank")');
  await page.waitForTimeout(500);

  // Press Escape to dismiss the Lineage overlay
  console.log("Dismissing lineage overlay...");
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Click "+ add class"
  console.log("Clicking '+ add class'...");
  await page.click('.b-class-add');
  await page.waitForSelector('.b-overlay');

  // Print all class picker rows
  const classes = page.locator('.b-picker-row');
  const count = await classes.count();
  console.log(`Found ${count} classes in picker:`);
  for (let i = 0; i < count; i++) {
    const text = await classes.nth(i).textContent();
    console.log(`  ${i}: "${text.trim()}"`);
  }

  // Click Mage
  console.log("Selecting Mage...");
  const mageRow = classes.filter({ hasText: 'Mage' });
  await mageRow.click();
  await page.waitForTimeout(500);

  // Click Choose button
  console.log("Clicking Choose button...");
  await page.click('.b-read-choose');
  await page.waitForTimeout(1000);

  // Print body class names or headings
  const headers = page.locator('h2');
  const headerCount = await headers.count();
  console.log(`Found ${headerCount} section headers:`);
  for (let i = 0; i < headerCount; i++) {
    console.log(`  Header ${i}: "${await headers.nth(i).textContent()}"`);
  }

  // Check if Skills list is rendered and print it
  const skills = page.locator('.b-section:has-text("Skills") .b-row');
  const skillsCount = await skills.count();
  console.log(`Skills count: ${skillsCount}`);
  for (let i = 0; i < skillsCount; i++) {
    console.log(`  Skill ${i}: "${await skills.nth(i).textContent()}"`);
  }

  await browser.close();
}

run().catch(console.error);
