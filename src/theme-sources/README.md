# 主题配色来源与适配

程序保留“默认”“暖砂”，新增 18 个主题家族；每个家族都有浅色和深色配置。选择一个公开参考版本，不追求与用户当前 Codex 构建逐项一致。

主要参考为社区整理的 Codex Themes：

- https://github.com/shaw-baobao/codex-themes/tree/ac4551873d0bb1b6c4a5c62c49510a7f5480f317
- 许可：`LICENSE-shaw.txt`。目录中保留所选原始 JSON。
- Ayu、猫布奇诺、德古拉、常青森林、GitHub、Gruvbox、东京之夜、材质、Monokai、北欧、一、玫瑰松、日光、Codex、绝对的基础主色来自这些配置。

Linear、Notion、北欧浅色、一浅色参考公开主题生成器中的数字配色记录：

- https://github.com/samuxbuilds/codex-themes/blob/3139c928366f129cb53d7eca18bfd2ddfcc899a3/src/lib/theme-generator.ts
- 程序未包含或执行该生成器代码；只采用选定的颜色数值，并在配置中保留出处。

“龙虾”采用 Ultra Lobster 的 lobster-time 配色参考，使用其中红色作为强调色：

- https://github.com/7368697661/Ultra-Lobster
- 固定的提交 URL 保存在 `theme-library.json`；所用配色块保存在 `lobster-time-reference.css`，许可为 `LICENSE-ultra-lobster.txt`。
- 这是同名风格参考，不声称来自 Codex 内置 Lobster 的完整定义。

缺少一种模式的主题，由已取得的参考主色补齐另一种模式。每个主题的 `references` 中记录了参考 URL 与补齐说明。

`src/theme-library.json` 保存主题的中文显示名、原名、来源和基础配色；`src/theme.cjs` 统一生成面板、边框、选中、悬停、提示词与进度条颜色，并调整文字对比度。媒体预览的固定对比色继续共用。

中文名称采用界面显示译名。GitHub、Linear、Notion、Codex 和 Ayu、Gruvbox、Monokai 等品牌或专名保留原名；内部 ID 保持稳定，与显示名称独立。

新增/修改参考配置后运行 `node scripts/build.cjs`。开发用导入脚本是 `scripts/import-theme-references.py`；应用运行与切换主题不需要联网。
