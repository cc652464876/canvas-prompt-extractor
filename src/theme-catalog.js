/* Generated from theme.cjs and theme-library.json. */
window.CanvasThemes=(()=>{const module={exports:{}};
'use strict';

// Single source for the desktop window, main UI and extraction feedback.
// The build emits CSS and a browser version from this module; do not edit those outputs.
const COMMON = {
  'primary-text':'#fff', 'media-bg':'#15181d', 'media-inner-bg':'#111',
  'media-text':'#e1e8f0', 'media-muted':'#b5bfcc', 'media-icon':'#8b99aa',
  'media-cover-muted':'#aab3c0', 'media-snippet':'#d5dce5',
  'media-label-bg':'#1119', 'media-label-text':'#e8eef6',
  'media-play-bg':'#1118', 'media-play-border':'#ffffff80',
  'media-control-bg':'#fffe', 'media-control-text':'#24364d', 'media-control-border':'#fff8',
  'media-load-bg':'#fff', 'media-load-text':'#263244', 'media-load-border':'#ddd',
  'media-ref-bg':'#171b21', 'media-ref-muted':'#8f9bac', 'media-number-bg':'#000a',
  'media-loading-bg':'#111a', 'media-pulse-bg':'#283443',
  'lens-border':'#fff', 'lens-shadow':'0 2px 12px #0008',
};
const LIGHT = {
  bg:'#f4f6fa', surface:'#fff', text:'#202b3c', muted:'#647185', line:'#e0e6ef',
  accent:'#2563c7', soft:'#edf4ff', success:'#216849', bad:'#9d2626', ref:'#f0f3f6',
  shadow:'0 4px 20px #21375306', 'primary-bg':'#205bc0', 'primary-hover':'#184ea9',
  'selection-bg':'#e7f1ff', 'selection-border':'#9bbfee', 'selection-text':'#174e9f', 'selection-hover':'#dbeaff',
  'warning-bg':'#fff8eb', 'warning-text':'#805715', 'warning-border':'#e7d2a7', attention:'#946013',
  'progress-track':'#e7edf6', 'progress-start':'#347ce4', 'progress-end':'#2360c2',
  'progress-success-start':'#35ac83', 'progress-success-end':'#25916e', 'progress-glow':'#a9caff50',
  'progress-track-shadow':'inset 0 1px 2px #314b7412', 'progress-fill-shadow':'0 1px 4px #2563c724',
  'loading-track':'#a4b9d466', 'loading-accent':'#9bc2ff',
  'prompt-text-color':'#202938', 'prompt-reference-color':'#808080', 'prompt-reference-hover':'#000',
  'popup-shadow':'0 8px 30px #0003', backdrop:'#182332a0',
};
const DARK = {
  ...LIGHT, bg:'#161c26', surface:'#202835', text:'#e7edf6', muted:'#a0aec1', line:'#354255',
  accent:'#93bbff', soft:'#283b56', success:'#9ad3b6', bad:'#ffadab', ref:'#333b46', shadow:'none',
  'selection-bg':'#2b4465', 'selection-border':'#648dc3', 'selection-text':'#d7e8ff', 'selection-hover':'#355176',
  'warning-bg':'#3a3225', 'warning-text':'#efd5a8', 'warning-border':'#66543a', attention:'#efd5a8',
  'progress-track':'#35445a', 'progress-start':'#5091f0', 'progress-end':'#3975d0',
  'prompt-text-color':'#fff', 'prompt-reference-hover':'#fff',
};
// Neutral default dark chrome; named reference palettes keep their own colors.
const DEFAULT_DARK = {
  ...COMMON,...DARK,
  bg:'#2d2d2b',surface:'#333331',text:'#f0f0ee',muted:'#adada8',line:'#494947',
  accent:'#9dbcf0',soft:'#3b3b38',ref:'#383836',
  'selection-bg':'#41413e','selection-border':'#666662','selection-text':'#f3f3f0','selection-hover':'#494946',
  'progress-track':'#484846','progress-track-shadow':'none','progress-fill-shadow':'none','progress-glow':'#ffffff20',
  'loading-track':'#b0b0aa55',backdrop:'#00000080',
  'media-bg':'#202020','media-inner-bg':'#181818','media-ref-bg':'#242424',
  'media-text':'#e4e4e2','media-muted':'#b5b5b0','media-cover-muted':'#ababa6',
  'media-snippet':'#d8d8d4','media-ref-muted':'#969690','media-pulse-bg':'#30302e',
};
const PALETTES = {
  default: {name:'默认', description:'浅色清爽，深色采用中性深灰与少量蓝色强调', light:{...COMMON,...LIGHT}, dark:DEFAULT_DARK},
  sand: {name:'暖砂', description:'米白与暖灰，搭配棕色强调色',
    light:{...COMMON,...LIGHT, bg:'#f5f1e8',surface:'#fffcf5',text:'#352f28',muted:'#71685d',line:'#ded5c6',
      accent:'#866036',soft:'#f2e8d8',ref:'#eee7da','primary-bg':'#886036','primary-hover':'#6e4927',
      'selection-bg':'#f1e4cf','selection-border':'#bc9761','selection-text':'#65451f','selection-hover':'#e9d8bb',
      'prompt-text-color':'#352f28','prompt-reference-color':'#776b5c','prompt-reference-hover':'#352f28',
      'progress-track':'#e5dccd','progress-start':'#ad824b','progress-end':'#886036',
      'loading-accent':'#ad824b','loading-track':'#bc976166'},
    dark:{...COMMON,...DARK, bg:'#242320',surface:'#2f2d29',text:'#ebdfc4',muted:'#b3a68e',line:'#4e493f',
      accent:'#e0b779',soft:'#40372a',ref:'#39352e','primary-bg':'#b48a52','primary-hover':'#c59a60','primary-text':'#211b13',
      'selection-bg':'#473b29','selection-border':'#9b7a48','selection-text':'#f0d7ad','selection-hover':'#55452e',
      'prompt-text-color':'#ebdfc4','prompt-reference-color':'#b3a68e','prompt-reference-hover':'#f0d7ad',
      'progress-track':'#4e493f','progress-start':'#d2aa6c','progress-end':'#b48a52',
      'loading-accent':'#e0b779','loading-track':'#9b7a4866'},
  },
};
const THEME_LIBRARY={"absolutely":{"name":"绝对","originalName":"Absolutely","description":"Absolutely 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/absolutely-light/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/absolutely-light/theme.json","adaptation":"该模式由已有参考配色补齐，沿用强调色与主题风格。"}},"light":{"accent":"#cc7d5e","background":"#f9f9f7","foreground":"#2d2d2b","surface":"#ffffff","contrast":45,"opaqueWindows":false,"semanticColors":{"diffAdded":"#2f9e44","diffRemoved":"#e03131","skill":"#a75d44"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#cc7d5e","background":"#2d2d2b","foreground":"#f9f9f7","contrast":45,"opaqueWindows":false,"semanticColors":{"diffAdded":"#2f9e44","diffRemoved":"#e03131","skill":"#a75d44"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"ayu":{"name":"Ayu","originalName":"Ayu","description":"Ayu 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/ayu-light/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/ayu-dark/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#f29718","background":"#fcfcfc","foreground":"#5c6166","surface":"#ffffff","contrast":20,"opaqueWindows":false,"semanticColors":{"diffAdded":"#6cbf43","diffRemoved":"#f07171","skill":"#399ee6"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#ffb454","background":"#0f1419","foreground":"#e6e1cf","surface":"#171b24","contrast":47,"opaqueWindows":false,"semanticColors":{"diffAdded":"#7fd962","diffRemoved":"#f26d78","skill":"#d2a6ff"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"catppuccin":{"name":"猫布奇诺","originalName":"Catppuccin","description":"Catppuccin 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/catppuccin-latte/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/catppuccin-mocha/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#1e66f5","background":"#eff1f5","foreground":"#4c4f69","surface":"#e6e9ef","contrast":22,"opaqueWindows":false,"semanticColors":{"diffAdded":"#40a02b","diffRemoved":"#d20f39","skill":"#8839ef"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#89b4fa","background":"#1e1e2e","foreground":"#cdd6f4","surface":"#313244","contrast":46,"opaqueWindows":false,"semanticColors":{"diffAdded":"#a6e3a1","diffRemoved":"#f38ba8","skill":"#cba6f7"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"dracula":{"name":"德古拉","originalName":"Dracula","description":"Dracula 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/dracula/theme.json","adaptation":"该模式由已有参考配色补齐，沿用强调色与主题风格。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/dracula/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#bd93f9","background":"#faf7fc","foreground":"#302a3b","contrast":55,"opaqueWindows":false,"semanticColors":{"diffAdded":"#50fa7b","diffRemoved":"#ff5555","skill":"#bd93f9"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#bd93f9","background":"#282a36","foreground":"#f8f8f2","surface":"#44475a","contrast":55,"opaqueWindows":false,"semanticColors":{"diffAdded":"#50fa7b","diffRemoved":"#ff5555","skill":"#bd93f9"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"everforest":{"name":"常青森林","originalName":"Everforest","description":"Everforest 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/everforest-light/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/everforest-dark/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#93b259","background":"#fdf6e3","foreground":"#5c6a72","surface":"#f4f0d9","contrast":26,"opaqueWindows":false,"semanticColors":{"diffAdded":"#8da101","diffRemoved":"#f85552","skill":"#df69ba"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#a7c080","background":"#2b3339","foreground":"#d3c6aa","surface":"#374145","contrast":44,"opaqueWindows":false,"semanticColors":{"diffAdded":"#a7c080","diffRemoved":"#e67e80","skill":"#d699b6"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"github":{"name":"GitHub","originalName":"GitHub","description":"GitHub 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/github-light/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/github-dark/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#0969da","background":"#ffffff","foreground":"#1f2328","surface":"#f6f8fa","contrast":18,"opaqueWindows":false,"semanticColors":{"diffAdded":"#1a7f37","diffRemoved":"#cf222e","skill":"#8250df"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#58a6ff","background":"#0d1117","foreground":"#c9d1d9","surface":"#161b22","contrast":40,"opaqueWindows":false,"semanticColors":{"diffAdded":"#3fb950","diffRemoved":"#f85149","skill":"#a371f7"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"gruvbox":{"name":"Gruvbox","originalName":"Gruvbox","description":"Gruvbox 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/gruvbox-light/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/gruvbox-dark/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#d79921","background":"#fbf1c7","foreground":"#3c3836","surface":"#ebdbb2","contrast":34,"opaqueWindows":false,"semanticColors":{"diffAdded":"#98971a","diffRemoved":"#cc241d","skill":"#b16286"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#d79921","background":"#282828","foreground":"#ebdbb2","surface":"#3c3836","contrast":61,"opaqueWindows":false,"semanticColors":{"diffAdded":"#98971a","diffRemoved":"#cc241d","skill":"#b16286"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"linear":{"name":"Linear","originalName":"Linear","description":"Linear 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/samuxbuilds/codex-themes/3139c928366f129cb53d7eca18bfd2ddfcc899a3/src/lib/theme-generator.ts","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/samuxbuilds/codex-themes/3139c928366f129cb53d7eca18bfd2ddfcc899a3/src/lib/theme-generator.ts","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#5e6ad2","background":"#f9f9fb","foreground":"#222326","semanticColors":{"diffAdded":"#4da672","diffRemoved":"#d94848"}},"dark":{"accent":"#5e6ad2","background":"#1a1a2e","foreground":"#e8e8f0","semanticColors":{"diffAdded":"#4da672","diffRemoved":"#d94848"}}},"lobster":{"name":"龙虾","originalName":"Lobster","description":"Lobster 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/7368697661/Ultra-Lobster/e3121703dddda008218872f4ac38cad602e25619/theme.css","adaptation":"参考 Ultra Lobster 的 lobster-time 配色，并以红色作为强调色；不声称等同 Codex 内置 Lobster。"},"dark":{"url":"https://raw.githubusercontent.com/7368697661/Ultra-Lobster/e3121703dddda008218872f4ac38cad602e25619/theme.css","adaptation":"参考 Ultra Lobster 的 lobster-time 配色，并以红色作为强调色；不声称等同 Codex 内置 Lobster。"}},"light":{"accent":"#ea5e41","background":"#e0f2fe","surface":"#f0f9ff","foreground":"#0a192f","semanticColors":{"diffAdded":"#a9d37e","diffRemoved":"#ea5e41"}},"dark":{"accent":"#ea5e41","background":"#0a1128","surface":"#121c3b","foreground":"#e6e9f0","semanticColors":{"diffAdded":"#5fb26b","diffRemoved":"#ea5e41"}}},"tokyo-night":{"name":"东京之夜","originalName":"Tokyo Night","description":"Tokyo Night 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/tokyo-day/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/tokyo-night/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#2959aa","background":"#e6e7ed","foreground":"#343b59","surface":"#dfe1e8","contrast":24,"opaqueWindows":false,"semanticColors":{"diffAdded":"#587539","diffRemoved":"#8c4351","skill":"#5a4a78"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#7aa2f7","background":"#1a1b26","foreground":"#c0caf5","surface":"#24283b","contrast":52,"opaqueWindows":false,"semanticColors":{"diffAdded":"#9ece6a","diffRemoved":"#f7768e","skill":"#bb9af7"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"material":{"name":"材质","originalName":"Material","description":"Material 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/material-lighter/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/material-ocean/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#7c4dff","background":"#fafafa","foreground":"#546e7a","surface":"#ffffff","contrast":18,"opaqueWindows":false,"semanticColors":{"diffAdded":"#91b859","diffRemoved":"#ff5370","skill":"#c792ea"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#82aaff","background":"#263238","foreground":"#eeffff","surface":"#2e3c43","contrast":46,"opaqueWindows":false,"semanticColors":{"diffAdded":"#c3e88d","diffRemoved":"#f07178","skill":"#c792ea"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"monokai":{"name":"Monokai","originalName":"Monokai","description":"Monokai 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/monokai/theme.json","adaptation":"该模式由已有参考配色补齐，沿用强调色与主题风格。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/monokai/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#fd971f","background":"#faf7fc","foreground":"#302a3b","contrast":56,"opaqueWindows":false,"semanticColors":{"diffAdded":"#a6e22e","diffRemoved":"#f92672","skill":"#ae81ff"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#fd971f","background":"#272822","foreground":"#f8f8f2","surface":"#3e3d32","contrast":56,"opaqueWindows":false,"semanticColors":{"diffAdded":"#a6e22e","diffRemoved":"#f92672","skill":"#ae81ff"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"nord":{"name":"北欧","originalName":"Nord","description":"Nord 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/samuxbuilds/codex-themes/3139c928366f129cb53d7eca18bfd2ddfcc899a3/src/lib/theme-generator.ts","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/nord/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#5e81ac","background":"#eceff4","foreground":"#2e3440","semanticColors":{"diffAdded":"#a3be8c","diffRemoved":"#bf616a"}},"dark":{"accent":"#88c0d0","background":"#2e3440","foreground":"#eceff4","surface":"#3b4252","contrast":43,"opaqueWindows":false,"semanticColors":{"diffAdded":"#a3be8c","diffRemoved":"#bf616a","skill":"#b48ead"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"notion":{"name":"Notion","originalName":"Notion","description":"Notion 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/samuxbuilds/codex-themes/3139c928366f129cb53d7eca18bfd2ddfcc899a3/src/lib/theme-generator.ts","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/samuxbuilds/codex-themes/3139c928366f129cb53d7eca18bfd2ddfcc899a3/src/lib/theme-generator.ts","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#3183d8","background":"#ffffff","foreground":"#37352f","semanticColors":{"diffAdded":"#008000","diffRemoved":"#a31515"}},"dark":{"accent":"#529cca","background":"#191919","foreground":"#e3e2e0","semanticColors":{"diffAdded":"#4dab9a","diffRemoved":"#c4554d"}}},"one":{"name":"一","originalName":"One","description":"One 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/samuxbuilds/codex-themes/3139c928366f129cb53d7eca18bfd2ddfcc899a3/src/lib/theme-generator.ts","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/one-dark/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#4078f2","background":"#fafafa","foreground":"#383a42","semanticColors":{"diffAdded":"#50a14f","diffRemoved":"#e45649"}},"dark":{"accent":"#61afef","background":"#282c34","foreground":"#abb2bf","surface":"#353b45","contrast":41,"opaqueWindows":false,"semanticColors":{"diffAdded":"#98c379","diffRemoved":"#e06c75","skill":"#c678dd"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"rose-pine":{"name":"玫瑰松","originalName":"Rosé Pine","description":"Rosé Pine 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/rose-pine-dawn/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/rose-pine/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#d7827e","background":"#faf4ed","foreground":"#575279","surface":"#fffaf3","contrast":18,"opaqueWindows":false,"semanticColors":{"diffAdded":"#56949f","diffRemoved":"#b4637a","skill":"#907aa9"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#c4a7e7","background":"#191724","foreground":"#e0def4","surface":"#26233a","contrast":44,"opaqueWindows":false,"semanticColors":{"diffAdded":"#9ccfd8","diffRemoved":"#eb6f92","skill":"#c4a7e7"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"solarized":{"name":"日光","originalName":"Solarized","description":"Solarized 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/solarized-light/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/solarized-dark/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#268bd2","background":"#fdf6e3","foreground":"#586e75","surface":"#eee8d5","contrast":22,"opaqueWindows":false,"semanticColors":{"diffAdded":"#859900","diffRemoved":"#dc322f","skill":"#6c71c4"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#268bd2","background":"#002b36","foreground":"#839496","surface":"#073642","contrast":36,"opaqueWindows":false,"semanticColors":{"diffAdded":"#859900","diffRemoved":"#dc322f","skill":"#6c71c4"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}},"codex":{"name":"Codex","originalName":"Codex","description":"Codex 参考配色","references":{"light":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/codex-dark/theme.json","adaptation":"该模式由已有参考配色补齐，沿用强调色与主题风格。"},"dark":{"url":"https://raw.githubusercontent.com/shaw-baobao/codex-themes/ac4551873d0bb1b6c4a5c62c49510a7f5480f317/themes/codex-dark/theme.json","adaptation":"公开参考主题数据；组件颜色由程序统一适配。"}},"light":{"accent":"#339cff","background":"#faf7fc","foreground":"#302a3b","contrast":45,"opaqueWindows":false,"semanticColors":{"diffAdded":"#34c759","diffRemoved":"#ff5f57","skill":"#7c8cff"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}},"dark":{"accent":"#339cff","background":"#181818","foreground":"#ffffff","surface":"#2d2d2b","contrast":45,"opaqueWindows":false,"semanticColors":{"diffAdded":"#34c759","diffRemoved":"#ff5f57","skill":"#7c8cff"},"fonts":{"ui":"SF Pro Text","code":"SF Mono"}}}};
function mix(a,b,amount){
  const expand=value=>value.length===4?'#'+[...value.slice(1)].map(c=>c+c).join(''):value;
  a=expand(a);b=expand(b);
  return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-amount)+parseInt(b.slice(i,i+2),16)*amount).toString(16).padStart(2,'0')).join('');
}
function luminance(hex){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function readable(ink,bg){
  if(contrast(ink,bg)>=4.5)return ink;
  const target=contrast('#ffffff',bg)>contrast('#151515',bg)?'#ffffff':'#151515';
  for(let amount=.05;amount<=1.001;amount+=.05){const color=mix(ink,target,Math.min(1,amount));if(contrast(color,bg)>=4.5)return color;}
  return target;
}
function adaptReference(reference,mode){
  const dark=mode==='dark',base=dark?DARK:LIGHT,bg=reference.background,ink=readable(reference.foreground,bg),accent=reference.accent;
  let surface=reference.surface||mix(bg,dark?'#ffffff':'#ffffff',dark?.035:.5);
  for(let step=0;step<10&&contrast(ink,surface)<4.5;step++)surface=mix(surface,bg,.35);
  if(contrast(ink,surface)<4.5)surface=bg;
  const muted=readable(mix(ink,surface,.30),surface),line=mix(surface,ink,dark?.22:.16);
  const selection=mix(surface,accent,dark?.23:.14),selectionText=readable(ink,selection),warning=mix(surface,'#dba948',.14);
  const primaryText=contrast('#ffffff',accent)>contrast('#151515',accent)?'#ffffff':'#151515';
  const success=readable(reference.semanticColors?.diffAdded||base.success,surface),bad=readable(reference.semanticColors?.diffRemoved||base.bad,surface);
  return {...COMMON,...base,bg,surface,text:ink,muted,line,accent:readable(accent,surface),soft:selection,ref:mix(surface,ink,.05),success,bad,
    'primary-bg':accent,'primary-hover':mix(accent,primaryText==='#ffffff'?'#151515':'#ffffff',.10),'primary-text':primaryText,
    'selection-bg':selection,'selection-border':mix(surface,accent,.55),'selection-text':selectionText,'selection-hover':mix(selection,accent,.12),
    'warning-bg':warning,'warning-text':readable(dark?'#efd5a8':'#805715',warning),'warning-border':mix(surface,'#dba948',.45),attention:readable(dark?'#efd5a8':'#805715',surface),
    'progress-track':line,'progress-start':accent,'progress-end':mix(accent,bg,.12),'progress-success-start':success,'progress-success-end':mix(success,bg,.08),'progress-glow':accent+'50',
    'progress-track-shadow':'none','progress-fill-shadow':'none','loading-track':accent+'66','loading-accent':accent,
    'prompt-text-color':ink,'prompt-reference-color':muted,'prompt-reference-hover':ink,
    shadow:dark?'none':'0 4px 20px '+ink+'08',backdrop:bg+'b0'};
}
for(const [id,reference] of Object.entries(THEME_LIBRARY))PALETTES[id]={name:reference.name,originalName:reference.originalName,description:reference.description,references:reference.references,light:adaptReference(reference.light,'light'),dark:adaptReference(reference.dark,'dark')};
const MODES = ['light','dark','system'];
const DEFAULT_PREFERENCE = Object.freeze({palette:'default',mode:'light'});
const STORAGE_KEY = 'appearance-v1';
function normalizePreference(value) {
  if(typeof value==='string')return {palette:'default',mode:MODES.includes(value)?value:'light'};
  return {palette:Object.hasOwn(PALETTES,value?.palette)?value.palette:'default', mode:MODES.includes(value?.mode)?value.mode:'light'};
}
function resolveTheme(value, systemDark=false) {
  const preference=normalizePreference(value);
  const resolvedMode=preference.mode==='system'?(systemDark?'dark':'light'):preference.mode;
  return {...preference,resolvedMode,tokens:PALETTES[preference.palette][resolvedMode]};
}
function readPreference(storage) {
  try {
    const value=storage.getItem(STORAGE_KEY);
    if(value!==null){try{return normalizePreference(JSON.parse(value));}catch{}}
    return normalizePreference(storage.getItem('theme'));
  } catch {return {...DEFAULT_PREFERENCE};}
}
function applyTheme(root,value,systemDark=false) {
  const theme=resolveTheme(value,systemDark);
  root.dataset.palette=theme.palette;root.dataset.theme=theme.resolvedMode;root.dataset.themeMode=theme.mode;
  return theme;
}
function themeCss() {
  const rules=['/* Generated from src/theme.cjs. Run node scripts/build.cjs after changing palettes. */'];
  for(const [id,palette] of Object.entries(PALETTES))for(const mode of ['light','dark']) {
    const selector=(id==='default'&&mode==='light'?':root,\n':'')+`:root[data-palette="${id}"][data-theme="${mode}"]`;
    const tokens={...palette[mode],selected:'var(--primary-bg)'};
    rules.push(selector+' {\n  color-scheme: '+mode+';\n'+Object.entries(tokens).map(([key,value])=>`  --${key}: ${value};`).join('\n')+'\n}');
  }
  return rules.join('\n\n')+'\n';
}
module.exports={PALETTES,THEME_LIBRARY,MODES,DEFAULT_PREFERENCE,STORAGE_KEY,normalizePreference,resolveTheme,readPreference,applyTheme,themeCss};

return module.exports;})();
