import type { GeoJSONFeatureCollection, GeoJSONFeature } from './types';

/**
 * 从文件对象加载 GeoJSON
 */
export async function loadFromFile(file: File): Promise<GeoJSONFeatureCollection> {
  // 检查文件大小（超过 100MB 提示警告）
  const MAX_SIZE = 100 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new Error(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，最大支持 100MB`);
  }
  // 检查文件类型
  const ext = file.name.split('.').pop()?.toLowerCase();
  const validExts = ['geojson', 'json', 'topojson'];
  if (ext && !validExts.includes(ext)) {
    throw new Error(`不支持的文件格式 .${ext}，请使用 .geojson / .json / .topojson`);
  }
  const text = await file.text();
  return parseGeoJSON(text, file.name);
}

/**
 * 从 URL 加载 GeoJSON
 */
export async function loadFromUrl(url: string): Promise<GeoJSONFeatureCollection> {
  // 验证 URL 格式
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new Error(`不支持的协议: ${u.protocol}，请使用 http 或 https`);
    }
  } catch {
    throw new Error(`无效的 URL: ${url}`);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  // 检查返回内容是否为空
  if (!text.trim()) {
    throw new Error('URL 返回内容为空');
  }
  const name = url.split('/').pop() || 'remote-data';
  return parseGeoJSON(text, name);
}

/**
 * 从文本粘贴加载 GeoJSON
 */
export function loadFromText(text: string, name = 'pasted-data'): GeoJSONFeatureCollection {
  return parseGeoJSON(text, name);
}

/**
 * 解析 GeoJSON 文本，支持 FeatureCollection / Feature / Geometry / TopoJSON
 */
function parseGeoJSON(text: string, source: string): GeoJSONFeatureCollection {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // 提供更详细的解析错误信息
    const lines = text.split('\n');
    const preview = lines[0]?.slice(0, 50) || '';
    if (text.length === 0) {
      throw new Error('输入内容为空，请提供有效的 GeoJSON 数据');
    }
    throw new Error(`JSON 解析失败: 内容以 "${preview}" 开头，请检查是否为有效的 JSON 格式`);
  }

  return normalizeToFeatureCollection(data, source);
}

/**
 * 将各种 GeoJSON 格式归一化为 FeatureCollection
 */
function normalizeToFeatureCollection(data: unknown, source: string): GeoJSONFeatureCollection {
  if (!data || typeof data !== 'object') {
    throw new Error(`无效数据: ${source} 不是有效的 JSON 对象`);
  }

  const obj = data as Record<string, unknown>;

  // 已经是 FeatureCollection
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    const validFeatures = (obj.features as GeoJSONFeature[]).filter(
      (f) => f && f.type === 'Feature' && f.geometry
    );
    if (validFeatures.length === 0) {
      throw new Error(`数据异常: ${source} 中的 FeatureCollection 没有有效的 Feature（共 ${obj.features.length} 个）`);
    }
    return {
      type: 'FeatureCollection',
      features: validFeatures,
    };
  }

  // 单个 Feature
  if (obj.type === 'Feature' && obj.geometry) {
    return {
      type: 'FeatureCollection',
      features: [data as GeoJSONFeature],
    };
  }

  // Geometry 对象
  if (obj.type && obj.coordinates) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: data as GeoJSONFeature['geometry'],
          properties: {},
        },
      ],
    };
  }

  // TopoJSON 格式检测
  if (obj.type === 'Topology' && obj.objects) {
    const result = convertTopoJSON(data as TopoJSONTopology);
    if (result.features.length === 0) {
      throw new Error(`TopoJSON 解析失败: ${source} 中没有找到有效的几何要素`);
    }
    return result;
  }

  // 检查是否是数组格式的数据
  if (Array.isArray(data)) {
    throw new Error(`数据格式错误: ${source} 是 JSON 数组，GeoJSON 应为对象格式（如 FeatureCollection / Feature / Geometry）`);
  }

  throw new Error(
    `无法识别的格式: ${source}\n` +
    `支持的格式: GeoJSON FeatureCollection / Feature / Geometry / TopoJSON\n` +
    `当前 type 值: ${obj.type || '缺失'}`
  );
}

/** TopoJSON 类型 */
interface TopoJSONTopology {
  type: 'Topology';
  objects: Record<string, unknown>;
  arcs: number[][][];
  transform?: {
    scale: [number, number];
    translate: [number, number];
  };
}

/**
 * 简易 TopoJSON 转 GeoJSON FeatureCollection
 */
function convertTopoJSON(topology: TopoJSONTopology): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  for (const [, value] of Object.entries(topology.objects)) {
    const obj = value as { type: string; geometries?: Array<{ type: string; arcs?: number[][]; properties?: Record<string, unknown> }> };
    if (obj.type === 'GeometryCollection' && obj.geometries) {
      for (const geom of obj.geometries) {
        // 简化处理：仅提取有坐标的几何体
        if (geom.arcs) {
          features.push({
            type: 'Feature',
            geometry: decodeTopoGeometry(geom, topology),
            properties: geom.properties || {},
          });
        }
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

/**
 * 解码 TopoJSON 几何体（简化版，仅处理 Polygon 和 LineString）
 */
function decodeTopoGeometry(
  geom: { type: string; arcs?: number[][]; properties?: Record<string, unknown> },
  topology: TopoJSONTopology
): GeoJSONFeature['geometry'] {
  const { scale, translate } = topology.transform || {
    scale: [1, 1] as [number, number],
    translate: [0, 0] as [number, number],
  };

  function decodeCoord(arc: number[]): [number, number] {
    return [
      arc[0] * scale[0] + translate[0],
      arc[1] * scale[1] + translate[1],
    ];
  }

  function decodeArc(arcIndex: number): [number, number][] {
    const reversed = arcIndex < 0;
    const idx = reversed ? ~arcIndex : arcIndex;
    const arc = topology.arcs[idx];
    if (!arc) return [];

    // 解码 delta-encoded 坐标
    let x = 0, y = 0;
    const coords: [number, number][] = arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return decodeCoord([x, y]);
    });

    return reversed ? coords.reverse() : coords;
  }

  if (geom.type === 'Polygon' && geom.arcs) {
    const coordinates = geom.arcs.map((ring) =>
      ring.flatMap((arcIdx) => decodeArc(arcIdx))
    );
    return { type: 'Polygon', coordinates };
  }

  if (geom.type === 'LineString' && geom.arcs) {
    const coordinates = geom.arcs.flatMap((arcIdx) => decodeArc(arcIdx));
    return { type: 'LineString', coordinates };
  }

  // 默认返回空点
  return { type: 'Point', coordinates: [0, 0] };
}

/**
 * 从文件列表批量加载
 * @returns 成功加载的文件列表，失败的文件会在控制台输出详细错误
 */
export async function loadFromFiles(files: FileList | File[]): Promise<Array<{ name: string; data: GeoJSONFeatureCollection }>> {
  const results: Array<{ name: string; data: GeoJSONFeatureCollection }> = [];
  for (const file of Array.from(files)) {
    try {
      const data = await loadFromFile(file);
      results.push({ name: file.name.replace(/\.[^.]+$/, ''), data });
    } catch (err) {
      // 在控制台输出详细错误信息，方便用户调试
      console.error(`加载文件失败 [${file.name}]:`, (err as Error).message);
    }
  }
  return results;
}
