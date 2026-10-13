# 内嵌排版资源

这些浏览器资源随包分发，并由 `lib/render.js` 内嵌到生成的 HTML；常用公式模板与绘图操作不依赖远程字体或在线排版服务。

- `katex.cjs`：KaTeX，MIT，全文见 [KATEX-LICENSE](KATEX-LICENSE)。用于公式语法检查、预览和旧数学数据的 MathML 显示。项目来源：[KaTeX](https://github.com/KaTeX/KaTeX)。
- `mathjax-tex-svg.js`：MathJax **3.2.2** 的 TeX→SVG 浏览器组件，Apache-2.0，全文见 [MATHJAX-LICENSE](MATHJAX-LICENSE)。项目来源：[MathJax 3.2.2](https://github.com/mathjax/MathJax/tree/3.2.2)。插件使用本地 SVG 字形排版后在浏览器画布转为 PNG，保存原图、当前图和数学来源；图元图片输入仍只接受 PNG、JPEG 和 WebP，不开放 SVG 图片输入。

插件自身的 MIT 许可证不替代这些依赖的许可证。OCR 依赖与模型权重不在此目录分发，其安装与许可证由相应依赖提供。
