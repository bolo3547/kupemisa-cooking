const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Create icons directory
const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Icon sizes needed for PWA
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Draw rounded background
  const radius = size * 0.2;
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
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
  
  // Save PNG
  const buffer = canvas.toBuffer('image/png');
  const filename = path.join(iconsDir, `icon-${size}x${size}.png`);
  fs.writeFileSync(filename, buffer);
  console.log(`Created: icon-${size}x${size}.png`);
});

// Create screenshots
const screenshotSizes = [
  { name: 'screenshot-wide.png', width: 1280, height: 720 },
  { name: 'screenshot-narrow.png', width: 720, height: 1280 },
];

screenshotSizes.forEach(({ name, width, height }) => {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, width, height);
  
  // Header
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, width, 60);
  
  // Logo text
  ctx.fillStyle = '#f97316';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('🛢️ Fleet Oil Monitor', 20, 40);
  
  // Cards
  const cardWidth = width < 800 ? width - 40 : 300;
  const cardHeight = 150;
  const cardsPerRow = width < 800 ? 1 : 3;
  
  for (let i = 0; i < 6; i++) {
    const col = i % cardsPerRow;
    const row = Math.floor(i / cardsPerRow);
    const x = 20 + col * (cardWidth + 20);
    const y = 80 + row * (cardHeight + 20);
    
    // Card background
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.roundRect(x, y, cardWidth, cardHeight, 10);
    ctx.fill();
    
    // Card title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`Tank ${i + 1}`, x + 15, y + 30);
    
    // Progress bar background
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 15, y + 50, cardWidth - 30, 20);
    
    // Progress bar fill
    const percent = Math.random() * 100;
    ctx.fillStyle = percent < 20 ? '#ef4444' : percent < 50 ? '#f97316' : '#22c55e';
    ctx.fillRect(x + 15, y + 50, (cardWidth - 30) * (percent / 100), 20);
    
    // Percentage text
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.fillText(`${Math.round(percent)}% - ${Math.round(percent * 10)}L`, x + 15, y + 100);
  }
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(iconsDir, name), buffer);
  console.log(`Created: ${name}`);
});

console.log('\\nAll icons generated successfully!');
