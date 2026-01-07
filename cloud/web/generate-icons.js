const fs = require('fs');
const path = require('path');

// Create icons directory
const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// SVG icon template - oil droplet
const createSvgIcon = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f97316;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#ea580c;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#1a1a1a"/>
  <g transform="translate(${size * 0.15}, ${size * 0.1}) scale(${size / 100})">
    <path d="M35 10 C35 10 10 45 10 60 C10 78 22 90 35 90 C48 90 60 78 60 60 C60 45 35 10 35 10 Z" 
          fill="url(#grad)" stroke="#fff" stroke-width="2"/>
    <ellipse cx="25" cy="55" rx="8" ry="12" fill="rgba(255,255,255,0.3)" transform="rotate(-20 25 55)"/>
  </g>
</svg>`;

// Icon sizes needed for PWA
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Generate SVG icons
sizes.forEach(size => {
  const svg = createSvgIcon(size);
  const filename = path.join(iconsDir, `icon-${size}x${size}.svg`);
  fs.writeFileSync(filename, svg);
  console.log(`Created: ${filename}`);
});

// Create a simple HTML file to convert SVGs to PNGs (for manual conversion)
const converterHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Icon Converter</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #1a1a1a; color: white; }
    .icon { margin: 10px; display: inline-block; }
    canvas { display: block; margin: 5px 0; }
    a { color: #f97316; }
  </style>
</head>
<body>
  <h1>Fleet Oil Monitor - PWA Icons</h1>
  <p>Right-click each image and save as PNG:</p>
  <div id="icons"></div>
  <script>
    const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
    const container = document.getElementById('icons');
    
    sizes.forEach(size => {
      const div = document.createElement('div');
      div.className = 'icon';
      div.innerHTML = \`<h3>\${size}x\${size}</h3>\`;
      
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      
      // Draw background
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, size * 0.2);
      ctx.fill();
      
      // Draw oil droplet
      const scale = size / 100;
      const offsetX = size * 0.15;
      const offsetY = size * 0.1;
      
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      
      // Gradient
      const gradient = ctx.createLinearGradient(10, 10, 60, 90);
      gradient.addColorStop(0, '#f97316');
      gradient.addColorStop(1, '#ea580c');
      
      // Droplet shape
      ctx.beginPath();
      ctx.moveTo(35, 10);
      ctx.bezierCurveTo(35, 10, 10, 45, 10, 60);
      ctx.bezierCurveTo(10, 78, 22, 90, 35, 90);
      ctx.bezierCurveTo(48, 90, 60, 78, 60, 60);
      ctx.bezierCurveTo(60, 45, 35, 10, 35, 10);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Highlight
      ctx.beginPath();
      ctx.ellipse(25, 55, 8, 12, -20 * Math.PI / 180, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
      
      ctx.restore();
      
      div.appendChild(canvas);
      
      // Download link
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = \`icon-\${size}x\${size}.png\`;
      link.textContent = 'Download PNG';
      div.appendChild(link);
      
      container.appendChild(div);
    });
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(iconsDir, 'converter.html'), converterHtml);
console.log('Created: converter.html - Open this in browser to download PNG icons');

console.log('\\nIcon generation complete!');
console.log('For production, open public/icons/converter.html in a browser');
console.log('and download the PNG versions of each icon.');
