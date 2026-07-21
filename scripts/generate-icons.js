const sharp = require('sharp');
const path = require('path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SVG = path.join(ROOT, 'src/renderer/assets/Frames.svg');
const BUILD = path.join(ROOT, 'build');

const TRAY_1X = path.join(BUILD, 'tray-icon.png');
const TRAY_2X = path.join(BUILD, 'tray-icon@2x.png');
const APP_1024 = path.join(BUILD, 'icon-1024.png');

async function generateTrayIcon(size, visualSize, outputPath) {
  const radius = Math.round(visualSize * 0.22);
  const offset = Math.round((size - visualSize) / 2);

  const maskSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${offset}" y="${offset}" width="${visualSize}" height="${visualSize}"
             rx="${radius}" ry="${radius}" fill="black"/>
     </svg>`
  );

  const sourceInput = await sharp(SVG).resize(visualSize, visualSize).png().toBuffer();

  const result = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: sourceInput, top: offset, left: offset },
      { input: maskSvg, blend: 'dest-in' }
    ])
    .png()
    .toBuffer();

  const { data, info } = await sharp(result)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert to pure black + alpha for macOS template image:
  // keep original alpha, set RGB to 0
  const newData = Buffer.alloc(data.length);
  for (let i = 3; i < data.length; i += 4) {
    newData[i] = data[i];
  }

  await sharp(newData, {
    raw: { width: info.width, height: info.height, channels: 4 }
  })
    .png()
    .toFile(outputPath);

  console.log(`  ✓ ${path.basename(outputPath)} — ${size}×${size} template image`);
}

async function generateAppIcon() {
  await sharp(SVG)
    .resize(1024, 1024)
    .png()
    .toFile(APP_1024);
  console.log(`  ✓ icon-1024.png — 1024×1024`);

  execSync(`"${path.join(ROOT, 'scripts/make-icon.sh')}" "${APP_1024}"`, {
    cwd: ROOT,
    stdio: 'inherit'
  });
  console.log('  ✓ icon.icns');

  fs.unlinkSync(APP_1024);
}

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });

  console.log('Generating tray icons...');
  await generateTrayIcon(22, 16, TRAY_1X);
  await generateTrayIcon(44, 32, TRAY_2X);

  console.log('Generating app icon...');
  await generateAppIcon();

  console.log('All icons generated.');
}

main().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
