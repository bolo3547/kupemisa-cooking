const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const dir = __dirname;
const input = path.join(dir, 'wiring_schematic.svg');

// Ensure output dir exists (same folder)
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

// Helper to export PNGs at different DPI
async function exportPng(dpi, outName) {
  const out = path.join(dir, outName);
  console.log(`Exporting ${out} at ${dpi} DPI...`);
  await sharp(input, { density: dpi })
    .png({ quality: 100 })
    .toFile(out);
  console.log('Saved:', out);
}

// Export A4 PNG (300 DPI = 2480×3508 px)
async function exportA4(dpi, outName) {
  const out = path.join(dir, outName);
  console.log(`Exporting ${out} (A4 @ ${dpi} DPI, 2480x3508) ...`);
  // Render at higher density then resize/contain to A4 pixels
  const buffer = await sharp(input, { density: Math.max(dpi, 600) })
    .png()
    .toBuffer();
  await sharp(buffer)
    .resize(2480, 3508, { fit: 'contain', background: '#ffffff' })
    .png({ quality: 100 })
    .toFile(out);
  console.log('Saved:', out);
}

// Create a one-page A4 PDF embedding the A4 PNG
function createPdfFromPng(pngPath, pdfPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);
    doc.image(pngPath, 0, 0, { width: doc.page.width, height: doc.page.height });
    doc.end();
    stream.on('finish', () => {
      console.log('Saved PDF:', pdfPath);
      resolve();
    });
    stream.on('error', reject);
  });
}

async function exportFromSvg(svgPath, baseName) {
  // export PNGs
  await exportPngFromFile(svgPath, 150, `${baseName}_150dpi.png`);
  await exportPngFromFile(svgPath, 300, `${baseName}_300dpi.png`);
  await exportPngFromFile(svgPath, 600, `${baseName}_600dpi.png`);
  // export A4 + PDF
  const a4png = `${baseName}_a4_300dpi.png`;
  const a4pdf = `${baseName}_a4_300dpi.pdf`;
  await exportA4FromFile(svgPath, 300, a4png);
  await createPdfFromPng(path.join(dir, a4png), path.join(dir, a4pdf));
}

async function exportPngFromFile(filePath, dpi, outName) {
  const out = path.join(dir, outName);
  console.log(`Exporting ${out} from ${filePath} at ${dpi} DPI...`);
  await sharp(filePath, { density: dpi })
    .png({ quality: 100 })
    .toFile(out);
  console.log('Saved:', out);
}

async function exportA4FromFile(filePath, dpi, outName) {
  const out = path.join(dir, outName);
  console.log(`Exporting ${out} (A4 @ ${dpi} DPI, 2480x3508) from ${filePath} ...`);
  const buffer = await sharp(filePath, { density: Math.max(dpi, 600) })
    .png()
    .toBuffer();
  await sharp(buffer)
    .resize(2480, 3508, { fit: 'contain', background: '#ffffff' })
    .png({ quality: 100 })
    .toFile(out);
  console.log('Saved:', out);
}

async function main(){
  try {
    await exportFromSvg(path.join(dir, 'wiring_schematic.svg'), 'wiring_schematic');
    await exportFromSvg(path.join(dir, 'wiring_schematic_professional.svg'), 'wiring_schematic_professional');
    console.log('All exports complete.');
  } catch (err) {
    console.error('Export error:', err);
    process.exit(1);
  }
}

main();
