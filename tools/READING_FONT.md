# 小程序中文宋体资源

`weculture-miniprogram/pages/typography/serif-resource.js` 是从 **Noto Serif SC Regular 2.003** 裁剪并重命名生成的中文字体，使用 **SIL Open Font License 1.1**。原始版权声明、完整许可证、来源链接及源文件 SHA-256 同时保留在资源模块里。另附字体目录内的 `OFL.txt`。

原始字体与许可证来自维护者的固定版本：

- [Noto Serif SC Regular 2.003](https://raw.githubusercontent.com/notofonts/noto-cjk/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf)
- [官方 OFL 许可证](https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/LICENSE)

资源保留 GB2312 字符、拉丁字母、常用标点，以及小程序静态界面所用字符，当前覆盖 7,650 个 Unicode 字符。超出子集的生僻字和其他语言继续使用系统字体，避免显示空白或方框。字体内部名称改为 `WecultureReadingSerif`，避免使用原字体的保留名称。

字体设置页与资源模块位于 `reading-font` 分包，入口仍是 `/pages/typography/index`。主包通过 `require.async` 按需加载资源，使用 `wx.loadFontFace` 的 Data URL、`global: true` 和 `scopes: ['webview']` 注册。默认字体不加载资源；选择宋体后会保存到本机，下一次启动自动加载。没有运行时第三方字体服务器。

Data URL 需要微信基础库 **3.7.9** 或以上。依据 [微信官方 API 类型及说明](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)，更早版本不尝试加载并提示更新微信。字体加载失败时使用默认字体，宋体尚未就绪时不能保存为已应用；用户可重试。15 秒超时防止持续显示加载中。

重新生成需要 Python、`fonttools[woff]` 和 `brotli`。把上述原始字体下载到临时目录，然后运行：

```powershell
python tools/build-reading-font.py path/to/NotoSerifSC-Regular.otf
```

生成器保留源字体时间戳，确保相同输入可重复生成。资源模块内嵌完整许可证；总分包大小会在生成和字体测试时验证不超过 2 MB。不要手工修改生成文件或把字体移入主包。

验证：

```powershell
node --test weculture-miniprogram/test/typography.test.js
```

开发者工具已实际加载并渲染中文宋体，默认／宋体相同文案对照见 `.artifacts/reading-font-comparison.png`。保存、返回页面后应用、本机偏好保持、未保存预览与恢复默认均已验证。真机仍需在下一次手机体验包中确认不同设备的效果。
