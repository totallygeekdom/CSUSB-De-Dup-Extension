// Renders extension/icons/icon{16,32,48,128}.png from an inline SVG (a merge glyph on the orange header colour).
// Needs Playwright (the same one the smoke test uses); run by hand when the icon changes: node scripts/make-icons.js
const { chromium } = require('playwright');
const path = require('path');
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="32" fill="#ef6c00"/>
  <g fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M34 30v18c0 10 8 18 18 18h8"/><path d="M34 98V80"/><path d="M34 80c0-8 6-14 14-14"/>
    <path d="M60 66h26"/><path d="M76 52l14 14-14 14"/>
  </g>
</svg>`;
(async () => {
  const browser = await chromium.launch();
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:' + size + 'px;height:' + size + 'px}</style>' + SVG);
    await page.screenshot({ path: path.join(__dirname, '..', 'extension', 'icons', 'icon' + size + '.png'), omitBackground: true });
    await page.close();
  }
  await browser.close();
})();
