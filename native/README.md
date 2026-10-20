# Anatomy 桌面启动入口

桌面启动器在系统浏览器中打开插件的三维画板，复用相同的渲染、编辑、撤销和版本保存。

```bash
python3 native/app.py --project /工程/anatomy-名称
./native/run.sh /工程/anatomy-名称
```

需要 Python 3 标准库、Node.js 18 或更新版本，以及支持 WebGL2 的浏览器。工程目录中应已有插件生成的 `anatomy.html`。`native/anatomy3d.py` 保留为同一启动器的兼容入口。

```bash
# 打开已有的画板服务；查询参数与地址片段会正确保留
python3 native/app.py --url 'http://127.0.0.1:8767/anatomy.html#space'
# 无桌面环境，或希望手动打开地址
python3 native/app.py --project /工程/anatomy-名称 --no-open
# 指定首选端口，0 表示随机选择可用端口
python3 native/app.py --project /工程/anatomy-名称 --port 0 --no-open
```

启动器复用插件的 `lib/preview.js` 服务管理：核对画板文件与服务身份，复用已有服务，并在需要时启动服务。已存在的画板服务优先复用；`--port` 仅决定新服务的首选端口。

服务独立运行，启动器输出地址后退出。关闭浏览器标签页不会停止服务，避免其他标签页或插件失去连接。服务日志和身份文件保存在工程的 `.anatomy-runtime/` 目录中。需要停止时，先从输出 PID 与 `/api/health` 核对画板路径和身份，再结束对应进程。

修改通过网页的项目版本流程保存，启动器不改写 `body.json`。需要截图时使用浏览器截取当前画板。

```bash
python3 native/selftest.py
```

自检在临时工程中验证服务启动、重复调用复用同一服务、启动器退出后仍可访问、旧入口兼容、URL 片段保留，以及工程数据没有被启动器写入。它不会打开浏览器或加载识别模型，完成后只停止自检创建且已核验身份的服务。
