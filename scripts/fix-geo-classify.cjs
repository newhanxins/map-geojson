/**
 * 修复 geo 数据目录分类
 * 
 * 问题: 直辖市(北京/上海/天津/重庆/香港/澳门)的子区域被误分类为 city
 * 修复: 根据 adcode 规则重新分类
 *   - XX0000 → province
 *   - XXYY00 (YY≠00) → city  
 *   - XXYYZZ (ZZ≠00) → district
 *   - XX90XX → city (省直管市)
 * 另外: 需要为四川(510000)和重庆(500000)下载缺失的区县数据
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://geo.datav.aliyun.com/areas_v3/bound';
const GEO_DIR = path.join(__dirname, '..', 'geo');
const CITY_DIR = path.join(GEO_DIR, 'city');
const DISTRICT_DIR = path.join(GEO_DIR, 'district');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function download(url, filePath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 404) {
        console.log(`  [SKIP] ${path.basename(filePath)} (404)`);
        resolve(null);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          fs.writeFileSync(filePath, JSON.stringify(json));
          const sizeKB = (Buffer.byteLength(data) / 1024).toFixed(1);
          console.log(`  [OK] ${path.basename(filePath)} (${sizeKB} KB)`);
          resolve(json);
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/** 判断 adcode 属于哪个目录 */
function classifyAdcode(code) {
  const s = String(code);
  if (s.length !== 6) return null;
  const prov = parseInt(s.slice(0, 2));
  const city = parseInt(s.slice(2, 4));
  const dist = parseInt(s.slice(4, 6));
  
  if (city === 0 && dist === 0) return 'province'; // XX0000
  if (dist === 0) return 'city';                   // XXYY00
  return 'district';                                // XXYYZZ
}

async function main() {
  console.log('=== 修复 geo 数据目录分类 ===\n');

  // 1. 重新分类 city 目录中的文件
  console.log('--- 1. 重新分类 city 目录 ---');
  const cityFiles = fs.readdirSync(CITY_DIR).filter(f => f.endsWith('.json'));
  let movedCount = 0;

  for (const file of cityFiles) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;
    const adcode = parseInt(match[1]);
    const correctDir = classifyAdcode(adcode);
    
    if (correctDir === 'district') {
      const src = path.join(CITY_DIR, file);
      const dst = path.join(DISTRICT_DIR, file);
      fs.renameSync(src, dst);
      console.log(`  ${file} → district/`);
      movedCount++;
    }
  }
  console.log(`  移动了 ${movedCount} 个文件到 district/\n`);

  // 2. 下载四川省(510000)的市级数据 (之前可能缺失)
  console.log('--- 2. 四川省市级数据 ---');
  const scProvinceFull = JSON.parse(fs.readFileSync(
    path.join(GEO_DIR, 'province', '510000_full.json'), 'utf-8'
  ));
  
  const scCityAdcodes = [];
  for (const feature of scProvinceFull.features) {
    const adcode = feature.properties?.adcode;
    if (adcode && adcode !== 510000 && classifyAdcode(adcode) === 'city') {
      scCityAdcodes.push(adcode);
    }
  }
  
  console.log(`  找到 ${scCityAdcodes.length} 个市: ${scCityAdcodes.join(', ')}`);
  for (const code of scCityAdcodes) {
    const simplePath = path.join(CITY_DIR, `${code}.json`);
    const fullPath = path.join(CITY_DIR, `${code}_full.json`);
    
    if (!fs.existsSync(simplePath)) {
      console.log(`市: ${code} (补充下载)`);
      await download(`${BASE_URL}/${code}.json`, simplePath);
      await sleep(200);
    }
    if (!fs.existsSync(fullPath)) {
      await download(`${BASE_URL}/${code}_full.json`, fullPath);
      await sleep(200);
    }
  }

  // 3. 下载重庆市的市级数据
  console.log('\n--- 3. 重庆市区级数据 ---');
  const cqProvinceFull = JSON.parse(fs.readFileSync(
    path.join(GEO_DIR, 'province', '500000_full.json'), 'utf-8'
  ));

  const cqCityAdcodes = [];
  for (const feature of cqProvinceFull.features) {
    const adcode = feature.properties?.adcode;
    if (adcode && adcode !== 500000 && classifyAdcode(adcode) === 'city') {
      cqCityAdcodes.push(adcode);
    }
  }
  
  console.log(`  找到 ${cqCityAdcodes.length} 个市/区组: ${cqCityAdcodes.join(', ')}`);
  for (const code of cqCityAdcodes) {
    const simplePath = path.join(CITY_DIR, `${code}.json`);
    if (!fs.existsSync(simplePath)) {
      console.log(`市: ${code} (补充下载)`);
      await download(`${BASE_URL}/${code}.json`, simplePath);
      await sleep(200);
    }
    // 下载 _full 用于获取区县
    const fullPath = path.join(CITY_DIR, `${code}_full.json`);
    let cityFull = null;
    if (fs.existsSync(fullPath)) {
      cityFull = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } else {
      cityFull = await download(`${BASE_URL}/${code}_full.json`, fullPath);
      await sleep(200);
    }

    // 提取区县数据
    if (cityFull) {
      for (const feature of cityFull.features) {
        const dCode = feature.properties?.adcode;
        if (dCode && dCode !== code && classifyAdcode(dCode) === 'district') {
          const dSimple = path.join(DISTRICT_DIR, `${dCode}.json`);
          const dFull = path.join(DISTRICT_DIR, `${dCode}_full.json`);
          if (!fs.existsSync(dSimple)) {
            console.log(`  区县: ${dCode}`);
            await download(`${BASE_URL}/${dCode}.json`, dSimple);
            await sleep(200);
          }
          if (!fs.existsSync(dFull)) {
            await download(`${BASE_URL}/${dCode}_full.json`, dFull);
            await sleep(200);
          }
        }
      }
    }
  }

  // 4. 下载四川省的区县数据
  console.log('\n--- 4. 四川省区县数据 ---');
  for (const cityCode of scCityAdcodes) {
    const fullPath = path.join(CITY_DIR, `${cityCode}_full.json`);
    if (!fs.existsSync(fullPath)) {
      console.log(`  ${cityCode}_full.json 不存在, 跳过`);
      continue;
    }
    const cityFull = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    const districts = [];
    for (const feature of cityFull.features) {
      const dCode = feature.properties?.adcode;
      if (dCode && dCode !== cityCode && classifyAdcode(dCode) === 'district') {
        districts.push(dCode);
      }
    }
    
    if (districts.length > 0) {
      console.log(`  市 ${cityCode}: ${districts.length} 个区县`);
      for (const dCode of districts) {
        const dSimple = path.join(DISTRICT_DIR, `${dCode}.json`);
        const dFull = path.join(DISTRICT_DIR, `${dCode}_full.json`);
        if (!fs.existsSync(dSimple)) {
          console.log(`    区县: ${dCode}`);
          await download(`${BASE_URL}/${dCode}.json`, dSimple);
          await sleep(200);
        }
        if (!fs.existsSync(dFull)) {
          await download(`${BASE_URL}/${dCode}_full.json`, dFull);
          await sleep(200);
        }
      }
    }
  }

  // 统计
  console.log('\n=== 修复完成 ===');
  for (const d of ['country', 'province', 'city', 'district']) {
    const dirPath = path.join(GEO_DIR, d);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
    const totalSize = files.reduce((sum, f) => sum + fs.statSync(path.join(dirPath, f)).size, 0);
    console.log(`  ${d}: ${files.length} 个文件 (${(totalSize / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main().catch(err => {
  console.error('修复失败:', err.message);
  process.exit(1);
});
