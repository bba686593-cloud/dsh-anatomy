# Anatomy · 自由工程画板

**一张人和 AI 共同理解工程、讨论需求和修改实现的画板。**

AI 阅读真实工程，把你关心的内容解释到画板上；也可以从空白画板上的需求开始，共同构思。用截图、草图、文字、公式、空间结构或它们的组合来表达，按问题选择形式。人直接在画面上圈改、擦除、补画，AI 读取当前画面与页面选定版本，对照源码修改并验证结果。

## 主要功能

- **二维与三维绘制**：图形、文字、公式、图片和自由笔迹共用一张画板。
- **按问题组织表达**：解释实际界面、几何、行为或局部实现，不必把所有内容套成矩形与箭头；相关部位可关联源码，持续讨论和修改。
- **四角空间笔**：四束激光连接笔尖；组件挂在笔尖上，移动、三轴旋转后放置，也能直接画空间笔迹。
- **轮廓拉伸与对象编辑**：在任意姿态画平面轮廓并拉伸；点选、框选或圈选已有对象，再移动和旋转；结构分层先预览，应用后可撤销。
- **手写识别**：圈选中文或公式，交给 AI 或可选本地 OCR 识别，校对后确认。
- **工程协作**：源码映射、撤销重做、项目保存与历史版本，AI 按页面选定版本实施。

## 安装部署

需要 **Node.js 18+、Python 3.8+**；三维视图需要支持 **WebGL2** 的浏览器。画板运行在本机，图形运行时随包提供。

获取源码并打开可继续圈改的工程图解：

```bash
git clone https://github.com/bba686593-cloud/dsh-anatomy.git
cd dsh-anatomy
node examples/board-demo.mjs
```

打开终端返回的 `url`。基础画板与智能体识别无需安装本地 OCR。

**接入 Codex**：在支持插件命令的 Codex CLI 中注册本地目录：

```bash
codex plugin marketplace add /绝对路径/dsh-anatomy
codex plugin add anatomy@anatomy-local
```

重新开启会话即可使用；桌面端可在插件目录选择「Anatomy 本地开发」安装。配置格式见 [OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins)。

**接入其他 MCP 客户端**：将路径替换为本机目录，`--root` 指向要绘制和维护的工程：

```json
{
  "mcpServers": {
    "anatomy": {
      "command": "node",
      "args": ["/绝对路径/dsh-anatomy/scripts/mcp-server.mjs", "--root", "/绝对路径/你的工程"]
    }
  }
}
```

**接入 DSH**：在 profile 中添加依赖与 bundle，见 [DSH 配置](docs/REFERENCE.md#安装)。

**可选本地 OCR**：在插件目录执行 `npm run recognition:install` 和 `npm run recognition:warmup`，详见 [识别接入](docs/RELEASE-0.17.0.md)。

**升级**：更新插件后重启 Anatomy MCP，从本地服务重新打开画板即可使用新版界面；独立 HTML 用 `anatomy_render` 重新生成。已有工程和保存历史继续使用。

## 开始使用

已有工程可以告诉 AI「用 Anatomy 解释这个界面为什么这样工作」或「把这部分空间结构画给我看」；新想法可以直接描述需求，或从图片、手绘开始。AI 先做出可讨论的画面，你在相同部位继续圈改、补画，保存后告诉 AI「按当前选定版本实现」。无需先整理成流程图。

三维中，左键绘制或操作对象；右键拖动旋转视角，中键拖动平移视角，滚轮缩放视角。组件附在笔尖后可用 WASD／Q／E 移动，I／K、J／U、Z／X 分别绕 X、Y、Z 轴旋转，Enter 放置。Alt＋点击循环选择重叠内容，局部橡皮可擦文字、图片、形状与三维实体；「关系布局」按部位联系建立立体结构，减少交叉，先预览再应用。完整操作见画板内「操作说明」。

[下载发布包](https://github.com/bba686593-cloud/dsh-anatomy/releases/latest) · [使用与开发参考](docs/REFERENCE.md) · [更新记录](CHANGELOG.md) · [桌面启动入口](native/README.md)

MIT 许可证；第三方资源许可见 [资源说明](lib/vendor/README.md)。
