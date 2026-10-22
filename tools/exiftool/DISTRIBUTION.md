# 内置图片信息读取工具

- 版本：ExifTool 13.59，Windows x64 官方发行包。
- 上游：https://exiftool.org/ ，https://github.com/exiftool/exiftool
- 发行包：`exiftool-13.59_64.zip`，项目内将 `exiftool(-k).exe` 更名为 `exiftool.exe`，配套文件保持原样。
- 保留原包 `README.txt`、`exiftool_files/LICENSE`、`exiftool_files/Licenses_Strawberry_Perl.zip` 及发行说明。组件及许可证说明见 `exiftool_files/readme_windows.txt`。

完整复制本目录，包括 `exiftool_files/`。程序根据自身所在位置解析工具路径，使用参数管道和 JSON 在后台读取，不依赖系统 Path、独立 Python/Perl 安装或网络，不修改原始图片。

`bundled-version.json` 记录入口文件及关键配套文件的 SHA-256，便于核对更新后的发行包。此工具属于程序随附运行文件，不需要注册到用户 Path。
