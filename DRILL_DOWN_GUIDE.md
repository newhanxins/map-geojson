# 下钻功能配置指南

## 📋 目录

- [功能说明](#功能说明)
- [配置方式](#配置方式)
- [Geo 数据管理](#geo-数据管理)
- [构建模式对比](#构建模式对比)
- [常见问题](#常见问题)

---

## 功能说明

### 什么是下钻功能？

下钻功能允许用户点击省级区域，逐级深入到市级、区县级，查看更详细的地理边界数据。

- **省级**：点击省份 → 进入该省的所有市县
- **市级**：点击城市 → 进入该市的所有区县
- **区县级**：最细粒度，无法继续下钻

### 数据来源

下钻功能使用阿里 DataV 的 GeoJSON 边界数据，存储在 `geo/` 和 `public/geo/` 目录中：

```
geo/
├── country/      # 全国轮廓（100000.json）
├── province/     # 省级数据（34个省份）
├── city/         # 市级数据（约345个城市）
└── district/     # 区县数据（约3200个区县）
```

**数据量**：约 3600+ 个 JSON 文件，总大小约 100-200MB

---

## 配置方式

### 方式一：环境变量（推荐）

创建 `.env.local` 文件：

```bash
# 复制示例配置
cp .env.example .env.local
```

编辑 `.env.local`：

```env
# 启用下钻功能
VITE_ENABLE_DRILL_DOWN=true

# 禁用下钻功能
VITE_ENABLE_DRILL_DOWN=false
```

### 方式二：构建命令

```bash
# 启用下钻功能（仅限扩展模式）
npm run build:ext:drill

# 或者设置环境变量
set VITE_ENABLE_DRILL_DOWN=true && npm run build

# Linux/Mac
VITE_ENABLE_DRILL_DOWN=true npm run build
```

### 方式三：修改源码（不推荐）

编辑 `src/config.ts`：

```typescript
export const ENABLE_DRILL_DOWN: boolean = false; // 改为 false
```

---

## Geo 数据管理

### 默认配置（.gitignore）

项目默认**不提交** geo 数据到 Git 仓库：

```gitignore
# GeoJSON 地理数据（省市区边界数据，文件较多且体积大）
geo/
public/geo/
```

### 如果需要提交 geo 数据

**步骤 1**：修改 `.gitignore`，删除或注释掉 geo 相关规则：

```gitignore
# geo/
# public/geo/
```

**步骤 2**：下载 geo 数据（如果还没有）：

```bash
# 下载所有省市区数据
node scripts/download-geo-all.cjs

# 或者从 DataV 重新抓取
node scripts/download-datav-geo.cjs
```

**步骤 3**：提交数据：

```bash
git add geo/ public/geo/
git commit -m "添加省市区 GeoJSON 数据"
```

### 如果不需要下钻功能

**无需任何操作**！项目默认就是这种状态：

1. ✅ `.gitignore` 已忽略 geo 数据
2. ✅ Chrome 扩展模式默认禁用下钻
3. ✅ 构建产物体积小（不包含 geo 数据）

---

## 构建模式对比

| 构建模式 | 下钻功能 | 包含 geo 数据 | 输出目录 | 用途 |
|---------|---------|--------------|---------|------|
| `npm run dev` | ✅ 默认启用 | 需要本地存在 | 开发服务器 | 本地开发调试 |
| `npm run build` | ✅ 默认启用 | 需要本地存在 | `dist/` | Web 生产部署 |
| `npm run build:ext` | ❌ 默认禁用 | 不包含 | `dist-ext/` | Chrome 扩展发布 |
| `npm run build:ext:dev` | ❌ 默认禁用 | 不包含 | `dist-ext/` | Chrome 扩展开发 |
| `npm run build:ext:drill` | ✅ 强制启用 | 需要本地存在 | `dist-ext/` | 带下钻的扩展 |

---

## 常见问题

### Q1: 我想在 Web 模式下禁用下钻，怎么做？

**方案 A**：创建 `.env.local` 文件：

```env
VITE_ENABLE_DRILL_DOWN=false
```

**方案 B**：修改 `vite.config.ts`（第 18-21 行）：

```typescript
const enableDrillDown = isExtension
  ? process.env.VITE_ENABLE_DRILL_DOWN === 'true'
  : process.env.VITE_ENABLE_DRILL_DOWN === 'true'; // 改为严格判断
```

### Q2: 禁用下钻后，点击省份还有反应吗？

❌ 不会有任何反应。下钻功能被完全禁用，点击事件不会触发。

### Q3: 我只想要部分省份的数据，可以吗？

可以！只保留需要的省份文件：

```bash
# 示例：只保留北京、上海、广东
geo/
├── country/100000.json          # 全国轮廓（必需）
├── province/
│   ├── 110000.json              # 北京
│   ├── 310000.json              # 上海
│   └── 440000.json              # 广东
├── city/
│   └── (只保留这三个省的市)
└── district/
    └── (只保留这三个省的区县)
```

### Q4: Geo 数据从哪里来？

数据来源：[阿里 DataV GeoAtlas](http://datav.aliyun.com/portal/school/atlas/area_selector)

下载脚本：
- `scripts/download-datav-geo.cjs` - 从 DataV 下载
- `scripts/download-geo-all.cjs` - 批量下载所有层级
- `scripts/extract-china-regions.cjs` - 提取区域边界

### Q5: 如何验证下钻功能是否被禁用？

打开浏览器控制台，查看初始化日志：

```
GeoJSON Viewer initialized (下钻: OFF)  # 表示已禁用
GeoJSON Viewer initialized (下钻: ON)   # 表示已启用
```

### Q6: 禁用下钻功能能节省多少体积？

| 模式 | 包含 geo 数据 | gzip 后体积 |
|------|--------------|------------|
| 启用下钻 | ✅ 约 3600 个文件 | ~5-10 MB |
| 禁用下钻 | ❌ 0 个文件 | ~100-200 KB |

**节省**：约 **98%** 的体积！

---

## 推荐配置

### 个人开发者 / 小团队

```bash
# 本地开发：启用下钻（方便调试）
npm run dev

# 生产构建：禁用下钻（减小体积）
VITE_ENABLE_DRILL_DOWN=false npm run build
```

### 企业内部工具

```bash
# 始终启用下钻，提交 geo 数据到 Git
# 1. 修改 .gitignore
# 2. 下载 geo 数据
# 3. 提交到仓库
git add geo/ public/geo/ .gitignore
git commit -m "添加省市区数据"
```

### Chrome 扩展发布

```bash
# 标准发布：不含下钻（推荐，体积小）
npm run pack:zip

# 带下钻的完整版本
npm run build:ext:drill && npm run pack:zip
```

---

## 总结

| 您的需求 | 推荐方案 |
|---------|---------|
| 不想上传 geo 数据 | ✅ 保持当前 `.gitignore` 配置 |
| 某些构建不需要下钻 | ✅ 使用环境变量 `VITE_ENABLE_DRILL_DOWN=false` |
| Chrome 扩展默认无下钻 | ✅ 已自动配置，无需操作 |
| 完全禁用下钻功能 | ✅ 创建 `.env.local` 设置 `VITE_ENABLE_DRILL_DOWN=false` |

---

**最后更新**：2026-11-02
