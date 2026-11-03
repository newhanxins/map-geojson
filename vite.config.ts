import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

/**
 * Vite 构建配置
 *
 * 支持 4 种构建模式:
 * - development:    Web 开发模式 (HMR dev server)
 * - production:     Web 生产构建 → dist/
 * - extension:      Chrome Extension 生产构建 → dist-ext/
 * - extension-dev:  Chrome Extension 开发构建 → dist-ext/ (不压缩, 带 sourcemap)
 */
export default defineConfig(({ mode }) => {
  // 加载环境变量（必须在 defineConfig 内部调用）
  const env = loadEnv(mode, process.cwd());
  
  const isExtension = mode === 'extension' || mode === 'extension-dev';
  const isDev = mode === 'development' || mode === 'extension-dev';

  // 下钻功能开关
  // - 扩展模式：默认关闭（geo 数据 100-200MB，包体太大）
  // - 其他模式：默认开启
  // - 可通过 .env 文件 VITE_ENABLE_DRILL_DOWN 覆盖
  const enableDrillDown = isExtension
    ? env.VITE_ENABLE_DRILL_DOWN === 'true'   // 扩展：需显式启用
    : env.VITE_ENABLE_DRILL_DOWN !== 'false'; // 其他：默认启用
  
  console.log('[vite.config] mode:', mode, 'VITE_ENABLE_DRILL_DOWN:', env.VITE_ENABLE_DRILL_DOWN, '→ enableDrillDown:', enableDrillDown);

  // Extension 模式下的构建入口
  const extensionInput: Record<string, string> = {
    popup: resolve(__dirname, 'src/popup.html'),
    background: resolve(__dirname, 'src/extension/background.ts'),
    content: resolve(__dirname, 'src/extension/content.ts'),
  };

  // Web 模式下的构建入口
  const webInput: Record<string, string> = {
    main: resolve(__dirname, 'index.html'),
  };

  return {
    define: {
      // 注入到 src/core/app.ts 中
      __ENABLE_DRILL_DOWN__: JSON.stringify(enableDrillDown),
    },
    build: {
      outDir: isExtension ? 'dist-ext' : 'dist',
      emptyOutDir: true,
      minify: isDev ? false : 'terser',
      sourcemap: isDev,
      terserOptions: isDev
        ? undefined
        : {
            compress: {
              drop_console: true,
              drop_debugger: true,
            },
            format: {
              comments: false,
            },
          },
      rollupOptions: {
        input: isExtension ? extensionInput : webInput,
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'assets/[name][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    // 开发服务器始终为 Web 模式
    server: {
      port: 5173,
      strictPort: true,  // 端口被占用时直接报错，不自动切换
      open: true,
      host: true,
    },
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'src/core'),
        '@ui': resolve(__dirname, 'src/ui'),
      },
    },
    plugins: [
      // Extension 模式构建后复制 manifest.json 和图标
      isExtension && {
        name: 'extension-post-build',
        closeBundle() {
          // 复制 manifest.json
          const manifestSrc = resolve(__dirname, 'src/extension/manifest.json');
          const manifestDest = resolve(__dirname, 'dist-ext/manifest.json');
          if (fs.existsSync(manifestSrc)) {
            fs.copyFileSync(manifestSrc, manifestDest);
          }

          // 复制 icons
          const iconsDir = resolve(__dirname, 'public/icons');
          const destIconsDir = resolve(__dirname, 'dist-ext/icons');
          if (fs.existsSync(iconsDir)) {
            if (!fs.existsSync(destIconsDir)) {
              fs.mkdirSync(destIconsDir, { recursive: true });
            }
            for (const file of fs.readdirSync(iconsDir)) {
              fs.copyFileSync(
                resolve(iconsDir, file),
                resolve(destIconsDir, file)
              );
            }
          }

          // 修复 popup.html 中的资源路径
          // popup.html 在 dist-ext/src/ 目录下，而 JS/CSS 在 dist-ext/ 根目录
          // 所以需要将绝对路径 / 替换为相对路径 ../
          const popupHtml = resolve(__dirname, 'dist-ext/src/popup.html');
          if (fs.existsSync(popupHtml)) {
            let html = fs.readFileSync(popupHtml, 'utf-8');
            // 将绝对路径改为相对路径（popup.html 在 src/ 子目录）
            html = html.replace(/src="\//g, 'src="../');
            html = html.replace(/href="\//g, 'href="../');
            fs.writeFileSync(popupHtml, html);
          }

          // 移除 content.js 末尾多余的 export 语句
          const contentScriptPath = resolve(__dirname, 'dist-ext/content.js');
          if (fs.existsSync(contentScriptPath)) {
            let code = fs.readFileSync(contentScriptPath, 'utf-8');
            code = code.replace(/export\s*\{[^}]*\};?\s*$/, '');
            fs.writeFileSync(contentScriptPath, code);
          }
        },
      },
    ].filter(Boolean),
  };
});
