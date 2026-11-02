/**
 * 应用配置模块
 * 
 * 通过 Vite define 注入编译时常量，控制功能开关
 * 
 * 开发模式:    ENABLE_DRILL_DOWN = true  (含 geo 数据下钻)
 * Web 生产:    ENABLE_DRILL_DOWN = true  (含 geo 数据下钻)
 * 扩展生产:    ENABLE_DRILL_DOWN = false (不含 geo 数据，包体小)
 * 
 * 也可通过环境变量 VITE_ENABLE_DRILL_DOWN 覆盖默认值
 */

/** 是否启用下钻功能（省→市→区县） */
export const ENABLE_DRILL_DOWN: boolean =
  // @ts-ignore — 由 Vite define 注入
  typeof __ENABLE_DRILL_DOWN__ !== 'undefined'
    // @ts-ignore
    ? __ENABLE_DRILL_DOWN__
    : true;

/** 应用版本号 */
export const APP_VERSION = '1.0.0';
