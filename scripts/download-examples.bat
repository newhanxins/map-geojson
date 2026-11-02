@echo off
chcp 65001 >nul
echo ========================================
echo GeoJSON 数据下载配置示例
echo ========================================
echo.

echo 【示例 1】默认配置（推荐）
echo 并发数: 5, 间隔: 100ms
echo 命令:
echo   node scripts/download-geo-all.cjs
echo.

echo 【示例 2】快速模式
echo 并发数: 10, 间隔: 50ms
echo 命令:
echo   set CONCURRENCY=10
echo   set DELAY=50
echo   node scripts/download-geo-all.cjs
echo.

echo 【示例 3】保守模式
echo 并发数: 1, 间隔: 200ms
echo 命令:
echo   set CONCURRENCY=1
echo   set DELAY=200
echo   node scripts/download-geo-all.cjs
echo.

echo 【示例 4】下载指定省份（四川省）
echo 命令:
echo   node scripts/download-geo-all.cjs 510000
echo.

echo 【示例 5】下载多个省份（北京、上海、广东）
echo 命令:
echo   node scripts/download-geo-all.cjs 110000 310000 440000
echo.

echo ========================================
echo 配置参数说明
echo ========================================
echo.
echo CONCURRENCY (并发数)
echo   默认: 5
echo   范围: 1-10
echo   说明: 同时下载的任务数
echo   API 限制: 不超过 10
echo.
echo DELAY (请求间隔)
echo   默认: 100ms
echo   范围: 50-1000ms
echo   说明: 每次请求后的等待时间
echo   API 限制: 不低于 100ms
echo.
echo TIMEOUT (超时时间)
echo   默认: 15000ms
echo   范围: 5000-30000ms
echo   说明: 单个请求的最大等待时间
echo.

echo ========================================
echo 性能对比
echo ========================================
echo.
echo 保守模式:  1 并发, 150ms 间隔 = 约 18 分钟
echo 默认配置:  5 并发, 100ms 间隔 = 约 4 分钟  ⭐ 推荐
echo 快速模式: 10 并发,  50ms 间隔 = 约 2 分钟
echo.

echo ========================================
echo 注意事项
echo ========================================
echo.
echo 1. 并发数和间隔会自动限制在有效范围内
echo 2. 脚本会自动检测配置是否符合 API 限制
echo 3. 如果下载失败，建议降低并发数或增加间隔
echo 4. 已存在的文件会自动跳过（增量下载）
echo.

echo ========================================
echo 立即运行测试
echo ========================================
echo.
echo 按任意键运行默认配置测试...
pause >nul
echo.
echo 正在运行...
node scripts/download-geo-all.cjs
