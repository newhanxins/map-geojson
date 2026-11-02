/**
 * 生成扩展图标 (PNG)
 * 使用纯 Node.js 创建简单的 PNG 图标
 * 无需任何外部依赖
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

/** 创建简单的 PNG 文件 */
function createPNG(width, height, drawFn) {
  // RGBA 像素数据
  const pixels = Buffer.alloc(width * height * 4, 0);

  // 绘制背景 - 蓝色圆角矩形
  const bgColor = { r: 79, g: 140, b: 255, a: 255 }; // #4F8CFF
  const fgColor = { r: 255, g: 255, b: 255, a: 255 }; // white

  // 填充背景
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // 圆角矩形判断
      const radius = width * 0.15;
      const inRect = isInRoundedRect(x, y, width, height, radius);
      if (inRect) {
        pixels[idx] = bgColor.r;
        pixels[idx + 1] = bgColor.g;
        pixels[idx + 2] = bgColor.b;
        pixels[idx + 3] = bgColor.a;
      }
    }
  }

  // 绘制地球图标 (简化的经纬线圆)
  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.32;

  // 画外圆
  drawCircle(pixels, width, cx, cy, r, fgColor, Math.max(1, width * 0.04));

  // 画水平线 (赤道)
  drawHLine(pixels, width, cx - r, cy, r * 2, fgColor, Math.max(1, width * 0.025));

  // 画垂直线 (本初子午线)
  drawVLine(pixels, width, cx, cy - r, r * 2, fgColor, Math.max(1, width * 0.025));

  // 画椭圆 (经线)
  drawEllipse(pixels, width, cx, cy, r * 0.5, r, fgColor, Math.max(1, width * 0.02));

  // 画地图定位标记
  const pinR = width * 0.08;
  const pinX = cx + r * 0.3;
  const pinY = cy - r * 0.2;
  drawFilledCircle(pixels, width, pinX, pinY, pinR, { r: 255, g: 100, b: 100, a: 255 });
  drawFilledCircle(pixels, width, pinX, pinY, pinR * 0.4, fgColor);

  return encodePNG(pixels, width, height);
}

function isInRoundedRect(x, y, w, h, r) {
  // 检查是否在圆角矩形内
  if (x < r && y < r) return (x - r) * (x - r) + (y - r) * (y - r) <= r * r;
  if (x >= w - r && y < r) return (x - (w - r)) * (x - (w - r)) + (y - r) * (y - r) <= r * r;
  if (x < r && y >= h - r) return (x - r) * (x - r) + (y - (h - r)) * (y - (h - r)) <= r * r;
  if (x >= w - r && y >= h - r) return (x - (w - r)) * (x - (w - r)) + (y - (h - r)) * (y - (h - r)) <= r * r;
  return x >= 0 && x < w && y >= 0 && y < h;
}

function setPixel(pixels, width, x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= width || y < 0 || y >= width) return;
  const idx = (y * width + x) * 4;
  // Alpha blend
  const a = color.a / 255;
  pixels[idx] = Math.round(color.r * a + pixels[idx] * (1 - a));
  pixels[idx + 1] = Math.round(color.g * a + pixels[idx + 1] * (1 - a));
  pixels[idx + 2] = Math.round(color.b * a + pixels[idx + 2] * (1 - a));
  pixels[idx + 3] = Math.min(255, pixels[idx + 3] + color.a);
}

function drawCircle(pixels, w, cx, cy, r, color, thickness) {
  for (let angle = 0; angle < 360; angle += 0.5) {
    const rad = angle * Math.PI / 180;
    for (let t = -thickness / 2; t <= thickness / 2; t += 0.5) {
      const x = cx + (r + t) * Math.cos(rad);
      const y = cy + (r + t) * Math.sin(rad);
      setPixel(pixels, w, x, y, color);
    }
  }
}

function drawEllipse(pixels, w, cx, cy, rx, ry, color, thickness) {
  for (let angle = 0; angle < 360; angle += 0.5) {
    const rad = angle * Math.PI / 180;
    for (let t = -thickness / 2; t <= thickness / 2; t += 0.5) {
      const x = cx + (rx + t) * Math.cos(rad);
      const y = cy + (ry + t) * Math.sin(rad);
      setPixel(pixels, w, x, y, color);
    }
  }
}

function drawFilledCircle(pixels, w, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) {
        setPixel(pixels, w, x, y, color);
      }
    }
  }
}

function drawHLine(pixels, w, x, y, length, color, thickness) {
  for (let i = 0; i < length; i++) {
    for (let t = -thickness / 2; t <= thickness / 2; t += 0.5) {
      setPixel(pixels, w, x + i, y + t, color);
    }
  }
}

function drawVLine(pixels, w, x, y, length, color, thickness) {
  for (let i = 0; i < length; i++) {
    for (let t = -thickness / 2; t <= thickness / 2; t += 0.5) {
      setPixel(pixels, w, x + t, y + i, color);
    }
  }
}

/** 编码为 PNG 文件 */
function encodePNG(pixels, width, height) {
  // PNG 签名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - 带过滤的像素数据
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    pixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(rawData);

  // IEND chunk
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 生成图标
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPNG(size, size, () => {});
  const filePath = path.join(ICONS_DIR, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created: ${filePath} (${png.length} bytes)`);
}

console.log('\nIcons generated successfully!');
