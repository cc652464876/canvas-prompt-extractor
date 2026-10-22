# 浏览器界面来源

标签栏直接使用 [adamschwartz/chrome-tabs](https://github.com/adamschwartz/chrome-tabs) 5.4.0，包含其原始 JavaScript、CSS 和 MIT 授权。固定提交为 `1046a3fd4d164bc3550d82dc46ff1f13c6438e2f`，下载于 2026-10-19。

原始文件位于 `vendor/chrome-tabs/`，未修改标签形状、尺寸计算、SVG、关闭图标或拖动动画。拖动依赖是上游 package.json 指定的 Draggabilly 2.2.0，使用其完整浏览器发行文件，位于 `vendor/draggabilly/`。所有文件随程序本地携带，不依赖 CDN；来源版本记录在 `vendor/UPSTREAM.json`。

`renderer.js` 负责接入应用：将上游组件的新建、关闭、激活、拖动排序操作交给 Electron 主进程，保留作品勾选、网页实例、快捷键、登录会话及读取期间的操作锁定。`style.css` 只排列组件与地址栏、补充可访问性和加载指示，不再绘制另一套标签形状。第三方文件不参加项目的格式化及静态规则改写。

## 尺寸与窗口

- 标签栏在 chrome-tabs 原始 46 DIP 上把顶部灰边收成 6 DIP、底部白条收成 2 DIP，整栏为 42 DIP；标签本体仍为 36 DIP，宽度及窄标签收缩由库计算。
- 标注的绿色内容行位于顶部 6 DIP 至 34 DIP，高 28 DIP；下拉按钮、网站图标、标题、关闭按钮及加号共用 20 DIP 的垂直中心。原库标签底部 8 DIP 保留为形状延伸区，内容不再随它向下偏移。
- 地址栏为 34 DIP 输入框。工具栏上内边距 4 DIP，与 2 DIP 白条合成 6 DIP；下内边距 6 DIP。工具栏高 44 DIP。
- 网页区域从 86 DIP 开始。尺寸统一定义于 `../browser-layout.cjs`。
- 使用 Electron 自带 Chromium；不启动或捆绑另一个 Chrome。窗口按钮继续使用 Windows 原生 `titleBarOverlay`；标签栏底部 2 DIP 白色横条贯穿整行，原生按钮区域预留这 2 DIP，避免两侧产生阶梯。
- 标签库通过运行时 style 元素和行内样式生成位置，因此仅本地导航页面允许内联样式；脚本仍仅加载本地文件，网页没有导航栏的 IPC 权限。

本次依据用户要求直接接入该组件，不运行测试或界面验收，交由用户先检查。

## 来源与授权

- Chrome Tabs：[仓库](https://github.com/adamschwartz/chrome-tabs)、[固定版本](https://github.com/adamschwartz/chrome-tabs/tree/1046a3fd4d164bc3550d82dc46ff1f13c6438e2f)、`vendor/chrome-tabs/LICENSE.txt`。
- Draggabilly：[2.2.0](https://github.com/desandro/draggabilly/tree/v2.2.0)，MIT；发行文件中保留原始依赖版权与授权说明，另附 README 和上游 MIT 授权页面 `vendor/draggabilly/LICENSE.html`。
- 导航按钮沿用 Google Material Icons，见 `icons/LICENSE` 和 `icons/NOTICE.txt`。
- 原生窗口按钮：[Electron 官方文档](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)。
