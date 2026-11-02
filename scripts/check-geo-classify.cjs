/**
 * 检查 geo 目录分类是否正确
 * 检测 city/ 目录中是否误放了 district 级别的文件
 */

const fs = require('fs');
const path = require('path');

const GEO_DIR = path.join(__dirname, '..', 'geo');
const CITY_DIR = path.join(GEO_DIR, 'city');
const DISTRICT_DIR = path.join(GEO_DIR, 'district');

/** 判断 adcode 属于哪个目录 */
function classifyAdcode(code) {
  const s = String(code);
  if (s.length !== 6) return null;
  const city = parseInt(s.slice(2, 4));
  const dist = parseInt(s.slice(4, 6));
  if (city === 0 && dist === 0) return 'province';
  if (dist === 0) return 'city';
  return 'district';
}

console.log('=== 检查 geo 目录分类 ===\n');

// 检查 city 目录
console.log('检查 city/ 目录...');
let misplacedFiles = [];
if (fs.existsSync(CITY_DIR)) {
  const cityFiles = fs.readdirSync(CITY_DIR).filter(f => f.endsWith('.json'));
  for (const file of cityFiles) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;
    const adcode = parseInt(match[1]);
    const correctDir = classifyAdcode(adcode);
    
    if (correctDir === 'district') {
      misplacedFiles.push({ file, currentDir: 'city', correctDir: 'district' });
    }
  }
}

if (misplacedFiles.length > 0) {
  console.log(`❌ 发现 ${misplacedFiles.length} 个文件分类错误！`);
  console.log('\n错误文件列表:');
  for (const item of misplacedFiles.slice(0, 20)) {
    console.log(`  ${item.file} -> 当前: ${item.currentDir}/, 应该: ${item.correctDir}/`);
  }
  if (misplacedFiles.length > 20) {
    console.log(`  ... 还有 ${misplacedFiles.length - 20} 个`);
  }
} else {
  console.log('✅ city/ 目录分类正确\n');
}

// 统计各级别文件数量
console.log('=== 文件统计 ===');
const stats = {};
for (const dir of ['country', 'province', 'city', 'district']) {
  const dirPath = path.join(GEO_DIR, dir);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
    const totalSize = files.reduce((sum, f) => sum + fs.statSync(path.join(dirPath, f)).size, 0);
    stats[dir] = {
      count: files.length,
      size: (totalSize / 1024 / 1024).toFixed(1) + ' MB'
    };
    console.log(`  ${dir}: ${stats[dir].count} 个文件 (${stats[dir].size})`);
  } else {
    console.log(`  ${dir}: 目录不存在`);
  }
}

// 检查特定省份的数据完整性
console.log('\n=== 检查特定省份数据 ===');
const checkProvinces = [
  { code: 510000, name: '四川省' },
  { code: 500000, name: '重庆市' },
  { code: 110000, name: '北京市' },
  { code: 310000, name: '上海市' },
];

for (const prov of checkProvinces) {
  const provFullPath = path.join(GEO_DIR, 'province', prov.code + '_full.json');
  if (!fs.existsSync(provFullPath)) {
    console.log(`  ${prov.name}: ❌ 省级 _full.json 不存在`);
    continue;
  }

  const provFull = JSON.parse(fs.readFileSync(provFullPath, 'utf-8'));
  const children = provFull.features.map(f => f.properties?.adcode).filter(Boolean);
  
  const cityCodes = children.filter(c => classifyAdcode(c) === 'city');
  const districtCodes = children.filter(c => classifyAdcode(c) === 'district');
  
  // 检查市级文件是否存在
  let cityMissing = 0;
  for (const cityCode of cityCodes) {
    const cityPath = path.join(CITY_DIR, cityCode + '.json');
    if (!fs.existsSync(cityPath)) {
      cityMissing++;
    }
  }
  
  // 检查区县文件是否存在
  let districtMissing = 0;
  for (const distCode of districtCodes) {
    const distPath = path.join(DISTRICT_DIR, distCode + '.json');
    if (!fs.existsSync(distPath)) {
      districtMissing++;
    }
  }
  
  if (cityMissing > 0 || districtMissing > 0) {
    console.log(`  ${prov.name}:`);
    if (cityMissing > 0) {
      console.log(`    ⚠️  缺失 ${cityMissing}/${cityCodes.length} 个市级文件`);
    }
    if (districtMissing > 0) {
      console.log(`    ⚠️  缺失 ${districtMissing}/${districtCodes.length} 个区县文件`);
    }
  } else {
    console.log(`  ${prov.name}: ✅ 数据完整`);
  }
}

console.log('\n=== 检查完成 ===');
if (misplacedFiles.length > 0) {
  console.log(`\n💡 建议运行修复脚本:`);
  console.log('   node scripts/fix-geo-classify.cjs');
} else if (Object.values(stats).some(s => s.count === 0)) {
  console.log('\n💡 建议下载数据:');
  console.log('   node scripts/download-geo-all.cjs');
}
