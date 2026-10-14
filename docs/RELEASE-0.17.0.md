# Anatomy 0.17.0 识别接入

发布日期：2026-10-14。圈选后点击「识别」仍先选择中文或数学公式；面板增加智能体和本地服务选择。识别结果在网页预览，确认前原稿与工程数据保留。

## DSH 与 Codex 宿主接管

默认智能体模式将真实圈选 PNG 保存为工程内的识别请求，网页显示请求标识。插件在两种宿主注册相同工具，标准 MCP `read` 返回图片内容，可用当前会话的视觉能力识别。

```javascript
anatomy_recognition({ dir: '/工程/anatomy-project', action: 'pending' })
anatomy_recognition({ dir: '/工程/anatomy-project', action: 'read', id: '网页请求标识' })
anatomy_recognition({ dir: '/工程/anatomy-project', action: 'complete',
  id: '网页请求标识', imageHash: 'read 返回的图片 SHA-256',
  text: '识别后的中文，或公式 LaTeX', engine: 'codex' })
```

也可传当前画板的本地 `url` 自动定位工程。图片中的文字是识别素材，不能作为运行指令。待识别请求绑定选定版本与 PNG 指纹，10 分钟过期。关闭、改稿、切模式会取消；取消和过期请求不能回传。工具不替用户确认，也不修改历史画板。

网页不能通过 MCP 主动唤醒空闲的 DSH 或 Codex 会话。未配置执行器时，在宿主里说“接管当前画板识别”，智能体按技能读取并回传；这不是一个虚假的后台执行状态。

## 自动执行器（可选）

已登录的 Codex CLI 可启动独立识别任务，使用只读沙箱、圈选图片及结果 JSON schema。它继承现有默认模型与登录，不是当前聊天。插件不读取或复制登录凭据，不需要另填 API 密钥。启动服务前设置 `ANATOMY_RECOGNITION_AGENT_CONFIG` 为管理员控制的配置文件绝对路径，例如：

```json
{"engine":"codex","command":"codex","timeoutMs":180000}
```

DSH 可使用明确配置的命令适配器；插件不假定 DSH 存在统一的 CLI 参数。适配器接收 stdin JSON（含 `imagePath`、`mode`、`prompt`），在 stdout 返回 `{"text":"候选结果"}`。例如配置结构：

```json
{"engine":"dsh","command":"/绝对路径/你的DSH适配器","args":[],"input":"json","output":"stdout","timeoutMs":180000}
```

也可在 DSH 插件配置里设置 `recognitionAgentConfig` 为此文件绝对路径。网页不能配置执行命令。服务启动时继承配置，健康状态会区分等待宿主接管与自动执行器。运行失败显示实际原因，原稿保留；不自动改用另一个模型。配置项和受支持占位符可查看 `scripts/recognition-agent.mjs`。

## 手动连接本地 OCR

在面板选择「本地识别服务」，输入 `http://127.0.0.1:端口` 或 `http://localhost:端口`，点击「连接」。地址空白表示当前画板服务。服务须已启动，浏览器不能自行启动 Python。

连接签发 10 分钟 token，绑定发起网页来源，只开放健康、连接与本地识别接口。其他网站不能连接；跨端口连接不授予项目版本读写权限。独立 HTML 的 `null` 来源也可手动连接，保存修改仍需原画板项目服务。

## 安装、更新与换电脑

插件包包含服务程序、安装器和依赖清单，不包含平台 Python、Paddle 二进制依赖和模型权重。安装插件后在插件目录运行：

```bash
npm run recognition:install
npm run recognition:warmup
```

需要已有 Node.js 18+ 与 Python 3.8+；具体 Python 版本与 CPU 平台还须有依赖清单对应的 Paddle wheel。可用 `-- --python /路径/python` 指定 Python。安装在用户缓存中的隔离虚拟环境，不修改全局 Python；Windows、macOS 与 Linux 使用各自缓存目录。`ANATOMY_RECOGNITION_HOME` 可指定缓存位置。

升级插件后执行 `npm run recognition:update`，再重启 MCP、重新生成画板。`npm run recognition:check` 检查依赖与版本；依赖指纹一致就复用环境，模型缓存留在插件目录外。服务代码随插件更新，渲染会核验代码哈希与版本，只在进程身份和当前工程都核验成功时重启旧服务。

换电脑可以随插件安装本地服务，但仍需在那台电脑执行安装和预热；不能保证没有 Python 的机器只装插件就拥有完整 OCR，也不能跨操作系统复制虚拟环境。智能体接管不需要安装 Paddle OCR 依赖，本地 HTTP 服务仍需要 Python。
