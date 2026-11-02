/**
 * 从阿里 DataV GeoJSON 数据中提取并简化中国区域边界
 * 生成精简版的 GeoJSON 用于坐标转换区域判断
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '../src/core/china-regions.ts');

// 读取 DataV 原始数据
const inputPath = 'C:\\Users\\YHC\\.qoder-cn\\cache\\projects\\chromeplug-dab4ffd3\\agent-tools\\task-312\\195fc633.txt';
const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

console.log(`原始 features: ${rawData.features.length}`);

// 需要提取的区域（adcode）
const REGIONS = {
  // 大陆省份（合并为一个 MultiPolygon）
  mainland: [
    110000, 120000, 130000, 140000, 150000, // 京津冀晋蒙
    210000, 220000, 230000,                   // 辽吉黑
    310000, 320000, 330000, 340000, 350000, 360000, 370000, // 沪苏浙皖闽赣鲁
    410000, 420000, 430000, 440000, 450000, 460000, // 豫鄂湘粤桂琼
    500000, 510000, 520000, 530000, 540000, // 渝川黔滇藏
    610000, 620000, 630000, 640000, 650000, // 陕甘青宁新
  ],
  // 港澳台
  hk: [810000],   // 香港
  mo: [820000],   // 澳门
  tw: [710000],   // 台湾
};

/** 简化坐标数组（每隔 N 个点取一个，保留关键点，并降低精度到小数点后 2 位） */
function simplifyCoords(coords, keepEvery) {
  if (coords.length <= 4) return coords.map(c => [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100]);
  const result = [];
  for (let i = 0; i < coords.length; i += keepEvery) {
    result.push([Math.round(coords[i][0] * 100) / 100, Math.round(coords[i][1] * 100) / 100]);
  }
  // 确保首尾闭合
  const last = coords[coords.length - 1];
  const resultLast = result[result.length - 1];
  if (last[0] !== resultLast[0] || last[1] !== resultLast[1]) {
    result.push([Math.round(last[0] * 100) / 100, Math.round(last[1] * 100) / 100]);
  }
  return result;
}

/** 简化几何体 */
function simplifyGeometry(geometry, keepEvery) {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map(ring => simplifyCoords(ring, keepEvery))
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map(polygon =>
        polygon.map(ring => simplifyCoords(ring, keepEvery))
      )
    };
  }
  return geometry;
}

/** 合并多个 Feature 的几何体为一个大 Polygon/MultiPolygon */
function mergeGeometries(features, keepEvery) {
  const allPolygons = [];
  for (const f of features) {
    const geom = f.geometry;
    if (geom.type === 'Polygon') {
      allPolygons.push(geom.coordinates.map(ring => simplifyCoords(ring, keepEvery)));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        allPolygons.push(poly.map(ring => simplifyCoords(ring, keepEvery)));
      }
    }
  }
  if (allPolygons.length === 1) {
    return { type: 'Polygon', coordinates: allPolygons[0] };
  }
  return { type: 'MultiPolygon', coordinates: allPolygons };
}

// 提取并简化各区域
const mainlandFeatures = rawData.features.filter(f => REGIONS.mainland.includes(f.properties.adcode));
const hkFeatures = rawData.features.filter(f => REGIONS.hk.includes(f.properties.adcode));
const moFeatures = rawData.features.filter(f => REGIONS.mo.includes(f.properties.adcode));
const twFeatures = rawData.features.filter(f => REGIONS.tw.includes(f.properties.adcode));

console.log(`大陆省份: ${mainlandFeatures.length} (简化比 1:5)`);
console.log(`香港: ${hkFeatures.length}`);
console.log(`澳门: ${moFeatures.length}`);
console.log(`台湾: ${twFeatures.length}`);

// 大陆合并并大幅简化（每8个点取1个，区域判断不需要高精度）
const mainlandGeom = mergeGeometries(mainlandFeatures, 8);
// 港澳台保持较高精度（每2个点取1个）
const hkGeom = mergeGeometries(hkFeatures, 2);
const moGeom = mergeGeometries(moFeatures, 1); // 澳门很小，不简化
const twGeom = mergeGeometries(twFeatures, 4);

// 生成 TypeScript 文件
const output = `/**
 * 中国区域边界数据（精简版）
 * 来源: 阿里 DataV (geo.datav.aliyun.com)
 * 用于坐标转换时的区域判断（大陆/港澳台/境外）
 * 大陆边界简化比 1:5，港澳台 1:2~3
 */

export type ChinaRegion = 'mainland' | 'hk' | 'mo' | 'tw' | 'overseas';

/** 中国区域边界 GeoJSON（简化版） */
export const CHINA_REGIONS: Record<ChinaRegion, GeoJSONGeometry | null> = {
  mainland: ${JSON.stringify(mainlandGeom)},
  hk: ${JSON.stringify(hkGeom)},
  mo: ${JSON.stringify(moGeom)},
  tw: ${JSON.stringify(twGeom)},
  overseas: null,
};

/** GeoJSON 几何类型 */
interface GeoJSONGeometry {
  type: 'Polygon' | 'MultiPolygon' | 'Point' | 'LineString';
  coordinates: unknown;
}
`;

fs.writeFileSync(OUTPUT_FILE, output, 'utf8');
const outputSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
console.log(`\n输出文件: ${OUTPUT_FILE}`);
console.log(`文件大小: ${outputSize} KB`);
