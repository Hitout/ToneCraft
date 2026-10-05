export interface CustomNavigationLayout {
  statusBarHeight: number;
  navigationBarHeight: number;
  contentTop: number;
}

const CONTENT_TOP_AFTER_SAFE_AREA = 80;
const FALLBACK_NAVIGATION_BAR_HEIGHT = 44;

/**
 * 根据系统状态栏和右上角胶囊位置计算自定义导航栏高度。
 *
 * 胶囊上下留白在不同机型并不固定，使用它作为基准可以让模式切换器始终
 * 与微信原生头部控件处于同一视觉中心线；正文从安全区顶部统一留出 80px。
 */
export function customNavigationLayout(): CustomNavigationLayout {
  let statusBarHeight = 0;
  try {
    statusBarHeight = wx.getWindowInfo().statusBarHeight ?? 0;
  } catch (_) {
    // 低版本基础库没有 getWindowInfo 时回退到兼容接口，不能让整个页面白屏。
    try {
      statusBarHeight = wx.getSystemInfoSync().statusBarHeight ?? 0;
    } catch (_) {
      statusBarHeight = 0;
    }
  }
  let menuButton = { top: 0, height: 0 };
  try {
    menuButton = wx.getMenuButtonBoundingClientRect();
  } catch (_) {
    // 模拟器或旧基础库没有胶囊信息时使用固定导航高度。
  }
  const topPadding = Math.max(menuButton.top - statusBarHeight, 0);
  const navigationBarHeight = menuButton.height > 0
    ? menuButton.height + topPadding * 2
    : FALLBACK_NAVIGATION_BAR_HEIGHT;

  // 页面从安全区顶部开始统一留出 80px；自定义导航栏只负责占据头部触摸区域，
  // 不能把导航栏高度再次叠加到正文间距中。
  const contentTop = statusBarHeight + Math.max(
    CONTENT_TOP_AFTER_SAFE_AREA,
    navigationBarHeight + 8,
  );

  return {
    statusBarHeight,
    navigationBarHeight,
    contentTop,
  };
}
