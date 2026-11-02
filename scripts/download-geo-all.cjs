/**
 * 通用 GeoJSON 数据增量下载脚本
 * 
 * 用法:
 *   node scripts/download-geo-all.cjs              # 下载所有省份的市+区县
 *   node scripts/download-geo-all.cjs 510000       # 只下载四川省的市+区县
 *   node scripts/download-geo-all.cjs 510000 500000 330000  # 下载多个省份
 * 
 * 配置参数（通过环境变量）:
 *   CONCURRENCY=5      # 并发数（默认 5，范围 1-10）
 *   DELAY=100          # 请求间隔毫秒（默认 100ms，范围 50-1000）
 *   TIMEOUT=15000      # 超时毫秒（默认 15000ms）
 * 
 * 示例:
 *   node scripts/download-geo-all.cjs                          # 默认配置
 *   set CONCURRENCY=10 && node scripts/download-geo-all.cjs   # 高并发（Windows）
 *   set DELAY=50 && node scripts/download-geo-all.cjs         # 快速模式（Windows）
 *   CONCURRENCY=10 DELAY=50 node scripts/download-geo-all.cjs # Linux/Mac
 * 
 * 特性:
 *   - 自动跳过已存在的文件（增量下载）
 *   - 自动分类到正确目录 (city/ 或 district/)
 *   - 同时下载 .json 和 _full.json
 *   - 可配置并发数和请求间隔
 *   - 遵守 DataV API 限制（并发 ≤10，间隔 ≥100ms）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://geo.datav.aliyun.com/areas_v3/bound';
const GEO_DIR = path.join(__dirname, '..', 'geo');
const PROVINCE_DIR = path.join(GEO_DIR, 'province');
const CITY_DIR = path.join(GEO_DIR, 'city');
const DISTRICT_DIR = path.join(GEO_DIR, 'district');

// ============ 可配置参数 ============
const CONCURRENCY = Math.min(10, Math.max(1, parseInt(process.env.CONCURRENCY) || 5));
const DELAY = Math.min(1000, Math.max(50, parseInt(process.env.DELAY) || 100));
const TIMEOUT = parseInt(process.env.TIMEOUT) || 15000;

console.log('=== 下载配置 ===');
console.log(`并发数: ${CONCURRENCY} (范围: 1-10, 默认: 5)`);
console.log(`请求间隔: ${DELAY}ms (范围: 50-1000ms, 默认: 100ms)`);
console.log(`超时时间: ${TIMEOUT}ms (默认: 15000ms)`);
console.log(`API 限制: 并发 ≤10, 间隔 ≥100ms`);
console.log(`当前配置: ${CONCURRENCY <= 10 && DELAY >= 100 ? '✅ 符合限制' : '⚠️  可能超出限制'}`);
console.log('================\n');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 并发控制器
 * 限制同时执行的任务数量
 */
class ConcurrencyLimiter {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.current = 0;
    this.queue = [];
  }

  async run(task) {
    if (this.current >= this.maxConcurrency) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.current++;
    try {
      return await task();
    } finally {
      this.current--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

const limiter = new ConcurrencyLimiter(CONCURRENCY);

function download(url, filePath) {
  return limiter.run(async () => {
    if (fs.existsSync(filePath)) {
      return null; // 已存在则跳过
    }
    
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: TIMEOUT }, (res) => {
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var json = JSON.parse(data);
            fs.writeFileSync(filePath, JSON.stringify(json));
            var sizeKB = (Buffer.byteLength(data) / 1024).toFixed(1);
            console.log('    [OK] ' + path.basename(filePath) + ' (' + sizeKB + ' KB)');
            resolve(json);
          } catch (e) {
            reject(new Error('JSON parse error: ' + e.message));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
    });
  });
}

/** 判断 adcode 属于哪个目录 */
function classifyAdcode(code) {
  var s = String(code);
  if (s.length !== 6) return null;
  var city = parseInt(s.slice(2, 4));
  var dist = parseInt(s.slice(4, 6));
  if (city === 0 && dist === 0) return 'province';
  if (dist === 0) return 'city';
  return 'district';
}

/** 下载一个区域的两份文件 */
async function downloadRegion(adcode, dir) {
  var simplePath = path.join(dir, adcode + '.json');
  var fullPath = path.join(dir, adcode + '_full.json');
  
  // 并发下载两个文件
  const [simpleData, fullData] = await Promise.all([
    download(BASE_URL + '/' + adcode + '.json', simplePath),
    download(BASE_URL + '/' + adcode + '_full.json', fullPath)
  ]);
  
  // 下载后延迟
  await sleep(DELAY);
  
  return { simpleData: simpleData, fullData: fullData };
}

/** 从 GeoJSON 中提取子区域 adcode */
function extractChildAdcodes(geojson) {
  if (!geojson || !geojson.features) return [];
  var codes = [];
  for (var i = 0; i < geojson.features.length; i++) {
    var adcode = geojson.features[i].properties && geojson.features[i].properties.adcode;
    if (adcode && codes.indexOf(adcode) === -1) {
      codes.push(adcode);
    }
  }
  return codes.sort(function(a, b) { return a - b; });
}

async function processProvince(provCode) {
  var provName = provCode;
  var provFullPath = path.join(PROVINCE_DIR, provCode + '_full.json');

  if (!fs.existsSync(provFullPath)) {
    console.log('  省级文件不存在: ' + provCode + '_full.json, 跳过');
    return { cities: 0, districts: 0 };
  }

  var provFull = JSON.parse(fs.readFileSync(provFullPath, 'utf-8'));
  var children = extractChildAdcodes(provFull);

  // 提取市级 adcode
  var cityCodes = [];
  for (var i = 0; i < children.length; i++) {
    if (classifyAdcode(children[i]) === 'city') {
      cityCodes.push(children[i]);
    }
  }

  var totalCities = 0;
  var totalDistricts = 0;

  console.log('  ' + provCode + ': ' + cityCodes.length + ' 个市');

  // 并发处理所有市
  const cityTasks = cityCodes.map(cityCode => async () => {
    console.log('  市: ' + cityCode);

    // 下载市级文件
    var result = await downloadRegion(cityCode, CITY_DIR);
    var cityDownloaded = result.simpleData || fs.existsSync(path.join(CITY_DIR, cityCode + '.json'));

    // 提取区县级 adcode
    var cityFull = result.fullData;
    if (!cityFull) {
      var cityFullPath2 = path.join(CITY_DIR, cityCode + '_full.json');
      if (fs.existsSync(cityFullPath2)) {
        cityFull = JSON.parse(fs.readFileSync(cityFullPath2, 'utf-8'));
      }
    }

    var districtCount = 0;
    if (cityFull) {
      var districts = extractChildAdcodes(cityFull).filter(function(d) {
        return classifyAdcode(d) === 'district';
      });

      if (districts.length > 0) {
        console.log('    区县: ' + districts.length + ' 个');
        
        // 并发下载所有区县
        const districtTasks = districts.map(districtCode => async () => {
          await downloadRegion(districtCode, DISTRICT_DIR);
        });
        
        await Promise.all(districtTasks.map(task => task()));
        districtCount = districts.length;
      }
    }

    return { cities: cityDownloaded ? 1 : 0, districts: districtCount };
  });

  // 执行所有市级任务（受并发限制）
  const results = await Promise.all(cityTasks.map(task => task()));
  
  for (const result of results) {
    totalCities += result.cities;
    totalDistricts += result.districts;
  }

  return { cities: totalCities, districts: totalDistricts };
}

async function main() {
  var startTime = Date.now();
  
  // 解析命令行参数
  var args = process.argv.slice(2);
  var targetProvinces = [];

  if (args.length === 0) {
    // 无参数：下载所有省份
    var provinceFiles = fs.readdirSync(PROVINCE_DIR).filter(function(f) {
      return f.endsWith('_full.json');
    });
    for (var i = 0; i < provinceFiles.length; i++) {
      var match = provinceFiles[i].match(/^(\d+)_full\.json$/);
      if (match) targetProvinces.push(parseInt(match[1]));
    }
    console.log('=== 下载所有省份的市+区县数据 ===');
    console.log('找到 ' + targetProvinces.length + ' 个省份\n');
  } else {
    // 有参数：只下载指定省份
    for (var j = 0; j < args.length; j++) {
      targetProvinces.push(parseInt(args[j]));
    }
    console.log('=== 下载指定省份的市+区县数据 ===');
    console.log('目标: ' + targetProvinces.join(', ') + '\n');
  }

  var totalStats = { cities: 0, districts: 0 };

  for (var p = 0; p < targetProvinces.length; p++) {
    var provCode = targetProvinces[p];
    console.log('省: ' + provCode);
    var stats = await processProvince(provCode);
    totalStats.cities += stats.cities;
    totalStats.districts += stats.districts;
  }

  // 统计
  var endTime = Date.now();
  var duration = ((endTime - startTime) / 1000).toFixed(1);
  
  console.log('\n=== 下载完成 ===');
  console.log('耗时: ' + duration + ' 秒');
  console.log('本次: ' + totalStats.cities + ' 个市, ' + totalStats.districts + ' 个区县');

  var dirs = ['country', 'province', 'city', 'district'];
  for (var d = 0; d < dirs.length; d++) {
    var dirPath = path.join(GEO_DIR, dirs[d]);
    var files = fs.readdirSync(dirPath).filter(function(f) { return f.endsWith('.json'); });
    var totalSize = files.reduce(function(sum, f) {
      return sum + fs.statSync(path.join(dirPath, f)).size;
    }, 0);
    console.log('  ' + dirs[d] + ': ' + files.length + ' 个文件 (' + (totalSize / 1024 / 1024).toFixed(1) + ' MB)');
  }
}

main().catch(function(err) {
  console.error('下载失败:', err.message);
  process.exit(1);
});
