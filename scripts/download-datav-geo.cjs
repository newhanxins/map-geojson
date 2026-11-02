/**
 * DataV GeoJSON 数据批量下载脚本
 * 
 * 从阿里 DataV (geo.datav.aliyun.com) 下载中国行政区划 GeoJSON 数据
 * 目录结构:
 *   geo/country/   - 全国 (100000)
 *   geo/province/  - 省级 (XX0000)
 *   geo/city/      - 市级 (XXYY00)
 *   geo/district/  - 区县级 (XXYYZZ)
 * 
 * 每个区域下载两份:
 *   {adcode}.json      - 简化边界 (文件小)
 *   {adcode}_full.json - 详细边界 (文件大)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://geo.datav.aliyun.com/areas_v3/bound';
const GEO_DIR = path.join(__dirname, '..', 'geo');

// 需要下载区县的省份 (adcode)
const DISTRICT_PROVINCES = [510000, 500000]; // 四川省、重庆市

/** 下载 JSON 文件 */
function download(url, filePath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 404) {
        console.log(`  [SKIP] ${path.basename(filePath)} (404)`);
        resolve(null);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
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
          reject(new Error(`JSON parse error for ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/** 等待指定毫秒 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 从 GeoJSON 中提取子区域 adcode 列表 */
function extractChildAdcodes(geojson) {
  if (!geojson || !geojson.features) return [];
  const codes = new Set();
  for (const feature of geojson.features) {
    const adcode = feature.properties?.adcode;
    if (adcode && adcode > 0) {
      codes.add(adcode);
    }
  }
  return [...codes].sort((a, b) => a - b);
}

/** 下载一个区域的两份文件 (简化 + 详细) */
async function downloadRegion(adcode, dir) {
  const simplePath = path.join(dir, `${adcode}.json`);
  const fullPath = path.join(dir, `${adcode}_full.json`);

  // 下载简化版
  const simpleData = await download(`${BASE_URL}/${adcode}.json`, simplePath);
  await sleep(200); // 避免请求太快

  // 下载详细版
  const fullData = await download(`${BASE_URL}/${adcode}_full.json`, fullPath);
  await sleep(200);

  return { simpleData, fullData };
}

/** 主下载流程 */
async function main() {
  console.log('=== DataV GeoJSON 数据下载 ===\n');
  console.log(`目标目录: ${GEO_DIR}\n`);

  // 1. 下载全国数据
  console.log('--- 1. 全国数据 ---');
  const { fullData: countryFull } = await downloadRegion(100000, path.join(GEO_DIR, 'country'));

  // 2. 下载省级数据
  console.log('\n--- 2. 省级数据 ---');
  const provinceAdcodes = extractChildAdcodes(countryFull);
  console.log(`找到 ${provinceAdcodes.length} 个省级区域\n`);

  const cityAdcodes = [];

  for (const pCode of provinceAdcodes) {
    const dir = path.join(GEO_DIR, 'province');
    console.log(`省: ${pCode}`);
    const { fullData: provFull } = await downloadRegion(pCode, dir);

    // 提取市级 adcode
    if (provFull) {
      const cities = extractChildAdcodes(provFull).filter(c => c !== pCode && c % 100 !== 0 || c % 10000 === 0);
      // 市级 adcode 特征: 前2位同省, 后2位为00 (但不是省级本身)
      const validCities = cities.filter(c => {
        if (c === pCode) return false; // 排除省级本身
        const provincePrefix = Math.floor(pCode / 10000);
        const cityPrefix = Math.floor(c / 10000);
        return cityPrefix === provincePrefix;
      });
      for (const c of validCities) {
        cityAdcodes.push({ adcode: c, parentProvince: pCode });
      }
    }
  }

  // 3. 下载市级数据
  console.log(`\n--- 3. 市级数据 (${cityAdcodes.length} 个市) ---`);
  const districtAdcodes = [];

  for (const { adcode: cCode, parentProvince } of cityAdcodes) {
    const dir = path.join(GEO_DIR, 'city');
    console.log(`市: ${cCode} (省: ${parentProvince})`);
    const { fullData: cityFull } = await downloadRegion(cCode, dir);

    // 仅对四川省和重庆市下载区县数据
    if (DISTRICT_PROVINCES.includes(parentProvince) && cityFull) {
      const districts = extractChildAdcodes(cityFull).filter(d => d !== cCode);
      for (const d of districts) {
        districtAdcodes.push({ adcode: d, parentCity: cCode });
      }
    }
  }

  // 4. 下载区县数据 (仅四川 + 重庆)
  if (districtAdcodes.length > 0) {
    console.log(`\n--- 4. 区县数据 (${districtAdcodes.length} 个区县, 四川+重庆) ---`);
    for (const { adcode: dCode, parentCity } of districtAdcodes) {
      const dir = path.join(GEO_DIR, 'district');
      console.log(`区县: ${dCode} (市: ${parentCity})`);
      await downloadRegion(dCode, dir);
    }
  }

  // 统计
  console.log('\n=== 下载完成 ===');
  const dirs = ['country', 'province', 'city', 'district'];
  for (const d of dirs) {
    const dirPath = path.join(GEO_DIR, d);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
    const totalSize = files.reduce((sum, f) => sum + fs.statSync(path.join(dirPath, f)).size, 0);
    console.log(`  ${d}: ${files.length} 个文件 (${(totalSize / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main().catch(err => {
  console.error('下载失败:', err.message);
  process.exit(1);
});
