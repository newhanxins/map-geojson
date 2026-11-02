/**
 * Chrome 扩展打包脚本
 * 
 * 支持格式:
 *   node scripts/pack-extension.cjs zip    → 生成 .zip (Chrome Web Store 上传用)
 *   node scripts/pack-extension.cjs crx    → 生成 .crx (本地安装用)
 *   node scripts/pack-extension.cjs both   → 同时生成 .zip 和 .crx
 * 
 * 输出: release/geo-viewer-{version}.{zip|crx}
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST_EXT_DIR = path.join(__dirname, '..', 'dist-ext');
const RELEASE_DIR = path.join(__dirname, '..', 'release');

// 读取版本号
const manifest = JSON.parse(
  fs.readFileSync(path.join(DIST_EXT_DIR, 'manifest.json'), 'utf-8')
);
const VERSION = manifest.version;

/** 确保 release 目录存在 */
function ensureReleaseDir() {
  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }
}

/** 创建 ZIP 文件 (Chrome Web Store 上传格式) */
function createZip() {
  ensureReleaseDir();
  const zipFile = path.join(RELEASE_DIR, 'geo-viewer-' + VERSION + '.zip');

  // 删除旧文件
  if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
  }

  console.log('创建 ZIP: ' + zipFile);
  console.log('源目录: ' + DIST_EXT_DIR);

  // 使用 Node.js 内置能力创建 ZIP
  // 方法: 通过 PowerShell Compress-Archive (Windows) 或 tar (跨平台)
  try {
    if (process.platform === 'win32') {
      // Windows: 使用 PowerShell
      const psCmd = 'powershell -Command "Compress-Archive -Path \'' +
        DIST_EXT_DIR.replace(/\\/g, '\\\\') + '\\*\' -DestinationPath \'' +
        zipFile.replace(/\\/g, '\\\\') + '\' -Force"';
      execSync(psCmd, { stdio: 'inherit' });
    } else {
      // Linux/Mac: 使用 zip 命令
      execSync('cd "' + DIST_EXT_DIR + '" && zip -r "' + zipFile + '" .', { stdio: 'inherit' });
    }
  } catch (e) {
    // 回退: 使用 Node.js 简单实现
    console.log('系统压缩工具不可用，使用内置 ZIP 实现...');
    createZipFallback(zipFile);
  }

  if (fs.existsSync(zipFile)) {
    const sizeMB = (fs.statSync(zipFile).size / 1024 / 1024).toFixed(2);
    console.log('ZIP 创建成功: ' + zipFile + ' (' + sizeMB + ' MB)');
  }
}

/** 内置 ZIP 实现 (无需外部工具) */
function createZipFallback(zipFile) {
  // 简单实现：将所有文件打包为 ZIP
  // 使用 Node.js zlib 模块
  const zlib = require('zlib');
  const files = getAllFiles(DIST_EXT_DIR, DIST_EXT_DIR);
  const chunks = [];

  // ZIP 文件头
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const relativePath = file.relative.replace(/\\/g, '/');
    const nameBuffer = Buffer.from(relativePath, 'utf-8');
    const content = fs.readFileSync(file.absolute);
    const compressed = zlib.deflateRawSync(content);

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);           // version needed
    localHeader.writeUInt16LE(0, 6);            // flags
    localHeader.writeUInt16LE(8, 8);            // compression (deflate)
    localHeader.writeUInt16LE(0, 10);           // mod time
    localHeader.writeUInt16LE(0, 12);           // mod date
    localHeader.writeUInt32LE(crc32(content), 14); // CRC-32
    localHeader.writeUInt32LE(compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(content.length, 22);    // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // name length
    localHeader.writeUInt16LE(0, 28);           // extra length
    nameBuffer.copy(localHeader, 30);

    // Central directory header
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);  // signature
    centralHeader.writeUInt16LE(20, 4);           // version made by
    centralHeader.writeUInt16LE(20, 6);           // version needed
    centralHeader.writeUInt16LE(0, 8);            // flags
    centralHeader.writeUInt16LE(8, 10);           // compression
    centralHeader.writeUInt16LE(0, 12);           // mod time
    centralHeader.writeUInt16LE(0, 14);           // mod date
    centralHeader.writeUInt32LE(crc32(content), 16); // CRC-32
    centralHeader.writeUInt32LE(compressed.length, 20); // compressed size
    centralHeader.writeUInt32LE(content.length, 24);    // uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28); // name length
    centralHeader.writeUInt16LE(0, 30);           // extra length
    centralHeader.writeUInt16LE(0, 32);           // comment length
    centralHeader.writeUInt16LE(0, 34);           // disk number
    centralHeader.writeUInt16LE(0, 36);           // internal attr
    centralHeader.writeUInt32LE(0, 38);           // external attr
    centralHeader.writeUInt32LE(offset, 42);      // local header offset
    nameBuffer.copy(centralHeader, 46);

    chunks.push(localHeader, compressed);
    centralHeaders.push(centralHeader);
    localHeaders.push(localHeader.length + compressed.length);
    offset += localHeader.length + compressed.length;
  }

  // End of central directory
  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) {
    chunks.push(ch);
    centralDirSize += ch.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);           // signature
  eocd.writeUInt16LE(0, 4);                     // disk number
  eocd.writeUInt16LE(0, 6);                     // central dir disk
  eocd.writeUInt16LE(files.length, 8);          // entries on disk
  eocd.writeUInt16LE(files.length, 10);         // total entries
  eocd.writeUInt32LE(centralDirSize, 12);       // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);     // central dir offset
  eocd.writeUInt16LE(0, 20);                    // comment length
  chunks.push(eocd);

  fs.writeFileSync(zipFile, Buffer.concat(chunks));
}

/** CRC-32 计算 */
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

/** 递归获取所有文件 */
function getAllFiles(dir, baseDir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...getAllFiles(fullPath, baseDir));
    } else {
      result.push({
        absolute: fullPath,
        relative: path.relative(baseDir, fullPath),
      });
    }
  }
  return result;
}

/** 创建 CRX 文件 (Chrome 扩展格式) */
function createCrx() {
  ensureReleaseDir();
  const crxFile = path.join(RELEASE_DIR, 'geo-viewer-' + VERSION + '.crx');

  console.log('创建 CRX: ' + crxFile);

  // CRX3 格式需要密钥签名，简化处理：
  // 先生成 ZIP，然后通过 Chrome --pack-extension 生成 CRX
  // 如果没有 Chrome，则只生成 ZIP 并提示
  const zipFile = path.join(RELEASE_DIR, 'geo-viewer-' + VERSION + '.zip');
  if (!fs.existsSync(zipFile)) {
    createZip();
  }

  // 尝试找到 Chrome 路径
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];

  let chromePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      chromePath = p;
      break;
    }
  }

  if (chromePath) {
    try {
      console.log('使用 Chrome 打包: ' + chromePath);
      execSync('"' + chromePath + '" --pack-extension="' + DIST_EXT_DIR +
        '" --pack-extension-key="' + path.join(__dirname, '..', 'extension.pem') + '"', {
        stdio: 'inherit',
      });
      // Chrome 会生成 .crx 在 dist-ext 的上级目录
      const generatedCrx = DIST_EXT_DIR + '.crx';
      if (fs.existsSync(generatedCrx)) {
        fs.renameSync(generatedCrx, crxFile);
        console.log('CRX 创建成功: ' + crxFile);
        return;
      }
    } catch (e) {
      console.log('Chrome 打包失败: ' + e.message);
    }
  }

  // 回退: CRX3 就是 ZIP + 特殊头部
  console.log('提示: 未找到 Chrome，CRX 文件需要 Chrome 浏览器生成');
  console.log('      ZIP 文件已生成，可直接用于 Chrome Web Store 上传');
  console.log('      如需 CRX，在 Chrome 中打开 chrome://extensions/ → 打包扩展程序');
}

/** 主流程 */
function main() {
  const format = process.argv[2] || 'zip';

  console.log('=== Chrome 扩展打包 ===');
  console.log('版本: ' + VERSION);
  console.log('格式: ' + format);
  console.log('');

  // 检查 dist-ext 是否存在
  if (!fs.existsSync(DIST_EXT_DIR)) {
    console.log('dist-ext/ 不存在，先执行扩展构建...');
    execSync('npm run build:ext', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
  }

  switch (format) {
    case 'zip':
      createZip();
      break;
    case 'crx':
      createCrx();
      break;
    case 'both':
      createZip();
      createCrx();
      break;
    default:
      console.log('用法: node scripts/pack-extension.cjs [zip|crx|both]');
      process.exit(1);
  }
}

main();
