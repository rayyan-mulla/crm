const puppeteer = require('puppeteer');
const fs = require('fs');

module.exports.generatePdf = async ({
  res,
  template,           // e.g. 'pdf'
  templateData,       // { pi, logoBase64, signBase64, documentTitle }
  filename,           // output pdf filename
  headerTitle          // 'PROFORMA INVOICE' | 'TAX INVOICE'
}) => {

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files'
    ]
  });

  const page = await browser.newPage();

  /* ===============================
     RENDER HTML
  =============================== */
  const html = await new Promise((resolve, reject) => {
    res.render(template, templateData, (err, rendered) => {
      if (err) reject(err);
      else resolve(rendered);
    });
  });

  await page.setContent(html, {
    waitUntil: ['load', 'domcontentloaded']
  });

  await page.evaluateHandle('document.fonts.ready');

  /* ===============================
     DEBUG FONTS (UNCHANGED)
  =============================== */
  try {
    const fontsPath = '/app/public/fonts';
    console.log(
      '[PDF DEBUG] fonts folder exists:',
      fs.existsSync(fontsPath)
    );

    if (fs.existsSync(fontsPath)) {
      console.log(
        '[PDF DEBUG] fonts found:',
        fs.readdirSync(fontsPath)
      );
    }
  } catch (e) {
    console.error('[PDF DEBUG] font folder error:', e);
  }

  const usedFont = await page.evaluate(() => {
    return window.getComputedStyle(document.body).fontFamily;
  });

  console.log('[PDF DEBUG] font used by Chromium:', usedFont);

  /* ===============================
     PDF GENERATION
  =============================== */
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,

    displayHeaderFooter: true,

    headerTemplate: `
      <style>
        @font-face {
          font-family: 'Roboto';
          src: url('file:///app/public/fonts/Roboto-Regular.ttf') format('truetype');
          font-weight: 400;
        }

        @font-face {
          font-family: 'Roboto';
          src: url('file:///app/public/fonts/Roboto-Bold.ttf') format('truetype');
          font-weight: 700;
        }

        * {
          font-family: 'Roboto';
        }
      </style>

      <div style="
        width:100%;
        padding:8px 15mm;
        box-sizing:border-box;
        display:flex;
        align-items:center;
        justify-content:space-between;
      ">
        <div style="width:30%; text-align:left;">
          <img src="${templateData.logoBase64}" style="height:42px;" />
        </div>

        <div style="
          width:40%;
          text-align:center;
          font-size:16px;
          font-weight:bold;
          letter-spacing:1px;
        ">
          ${headerTitle}
        </div>

        <div style="width:30%;"></div>
      </div>
    `,

    footerTemplate: `
      <style>
        * {
          font-family: 'Roboto';
        }
      </style>

      <div style="
        width:100%;
        padding:6px 15mm;
        font-size:10px;
        color:#666;
        box-sizing:border-box;
        text-align:center;
      ">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
    `,

    margin: {
      top: '85px',
      bottom: '50px',
      left: '15mm',
      right: '15mm'
    }
  });

  await browser.close();

  /* ===============================
     RESPONSE
  =============================== */
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${filename}"`
  );

  res.end(pdfBuffer);
};
