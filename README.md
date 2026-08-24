# GPTSession Convert

一个浏览器本地运行的凭证归一化与格式转换工具，支持 OpenAI/GPT Session、Grok/xAI、CPA、Sub2API、Codex-Manager、Codex CLI、Codex2API、Grok CLI、Grok2API，以及 AxonHub、9router 和 Cockpit 之间的转换，并提供 OpenAI OAuth 登录、回调和 `refresh_token` 生成流程。

![alt text](image.png)![alt text](image-1.png)

## 功能

- GPT Session / OpenAI 凭证转换为 CPA、Sub2API、Codex-Manager、Codex CLI、Codex2API、AxonHub、9router、Cockpit
- Grok / xAI 凭证转换为 CPA、Sub2API、Grok CLI、Grok2API、AxonHub、9router、Cockpit
- CPA、Sub2API、Codex、Grok 及自定义格式之间互转
- 支持单条 JSON、JSON 数组、JSONL 和批量账号
- 输入区支持粘贴 OpenAI / Grok OAuth JSON、JSONL，并提供获取 ChatGPT Session 的快捷入口
- 支持拖拽任意扩展名的凭据文件
- 支持选择多个凭据文件
- 支持选择本地目录递归导入凭据
- 支持 ZIP 凭据包导入（Store / Deflate）并校验 CRC
- 支持复制结果和下载 JSON、JSONL 或 ZIP 批量归档
- 内置 OpenAI RS256 与 xAI ES256 JWKS 快照，可离线验证 JWT 签名、发行方和受众
- 默认拦截签名无效、过期、尚未生效、未知 `kid`、未知 provider 或浏览器无法验签的 JWT
- 按 provider 和 access/refresh/session/id token 去重；冲突 token 不会被合并
- 最近转换记录按每次实际的源格式和目标格式保存
- 输出支持 `accounts`、`tokens/meta`、Codex `auth.json`、Grok CLI map 等真实结构
- OAuth PKCE 登录流程
- 自动接收 `http://localhost:1455/auth/callback`
- 生成包含 `refresh_token` 的目标格式配置

## Docker 部署

需要先安装 Docker Desktop。

在项目目录执行：

```powershell
cd GPTSession_convert
docker compose up -d --build
```

查看容器状态：

```powershell
docker compose ps
```

查看日志：

```powershell
docker compose logs -f
```

浏览器访问：

```text
http://localhost:1455/
```

停止容器：

```powershell
docker compose down
```

更新代码后重新构建：

```powershell
docker compose up -d --build
```

## Node.js 手动启动

需要 Node.js 22 或更高版本；Docker 镜像使用 Node.js 24。

```powershell
cd GPTSession_convert
node server.js
```

然后访问：

```text
http://localhost:1455/
```

服务默认只监听 `127.0.0.1`，不会向局域网开放。

## 直接打开静态页面

直接打开 `index.html` 可以使用格式转换、文件导入、复制和下载功能。

OAuth 功能建议通过 `http://localhost:1455/` 使用，因为 OAuth 回调地址固定为：

```text
http://localhost:1455/auth/callback
```

ZIP 导入依赖现代浏览器的 DecompressionStream，建议使用最新版 Chrome 或 Edge。JWKS 快照保存在 `static/jwks.js`，验签时不会联网拉取公钥。

## 项目结构

- `index.html`：页面结构
- `static/app.css`：页面样式
- `static/app.js`：转换、验签、导入导出与 OAuth 交互逻辑
- `static/jwks.js`：离线 JWKS 快照
- `server.js`：静态资源服务与 OAuth 回调、兑换代理
- `scripts/update-jwks.js`：JWKS 更新和一致性检查脚本
- `tests/`：前端核心、服务端与 JWKS 脚本回归测试

## 端口配置

默认端口为 `1455`。Docker Compose 只把服务绑定到宿主机的 `127.0.0.1:1455`。

手动启动时可以通过环境变量调整服务配置：

```powershell
$env:PORT = '1455'
$env:REDIRECT_URI = 'http://localhost:1455/auth/callback'
$env:CORS_ORIGINS = 'http://localhost:1455,http://127.0.0.1:1455'
node server.js
```

修改端口或回调地址后，还需要确保 OAuth Client 注册了完全相同的 `REDIRECT_URI`。除非明确需要远程访问，不要把 Docker 端口或 `HOST` 改成面向外部网络的配置。

只有在通过 `file://` 直接打开 `index.html` 并且仍要使用 OAuth 时，才需要把 `null` 加入 `CORS_ORIGINS`；通过本地服务访问页面不需要此配置。

## 测试

项目使用 Node.js 内置测试运行器，不需要安装第三方依赖：

```powershell
npm run check
npm test
```

检查内置 JWKS 是否仍与官方端点一致（此命令需要联网）：

```powershell
npm run check:jwks
```

需要更新快照时运行 `npm run update:jwks`，检查改动后重新执行完整测试。CI 会在 Node.js 22 和 24 上运行语法检查与测试，并验证 Docker 镜像可以构建；定时任务会检查 JWKS 是否需要轮换。

## 参考项目与网站

本项目在格式设计、输入识别、OAuth 流程和界面交互方面参考了以下公开项目与网站：

- [gtxx3600/GPTSession2CPAandSub2API](https://github.com/gtxx3600/GPTSession2CPAandSub2API)
- [gtxx3600/CPA2sub2API](https://github.com/gtxx3600/CPA2sub2API)
- [ltxgit/authconv](https://github.com/ltxgit/authconv)
- [authconv 在线演示](https://ltxgit.github.io/authconv/)
- [nloop Conversion](https://conversion.nloop.cc/)
- [Anything Tools ChatGPT Session Converter](https://anything.tools/zh-CN/dev/chatgpt-session-converter)
- [yangmx.bond Session 转换与 OAuth 工具](https://yangmx.bond/session2json/)

## 鸣谢

感谢上述项目和网站作者公开分享格式转换、凭据归一化、OAuth/PKCE、JWT 验证和批量导入导出的实现思路。本项目为独立实现，保留了 AxonHub、9router、Cockpit 等额外格式，并根据本项目的使用场景重新组织了转换流程和界面。

## 安全说明

- Session、JSON 和转换结果默认在浏览器本地处理。
- JWT 验签只使用页面内置的 JWKS 快照；未知 `kid`、未知 provider 或当前浏览器无法完成验签时默认禁止导出。快照轮换后应运行 `npm run update:jwks` 并重新发布页面。
- OAuth 兑换由本地 `server.js` 代理到 OpenAI Token Endpoint。
- 本项目不包含数据库，不会主动保存账号和 token。
- OAuth state 只在内存中短期保存，读取回调结果后立即删除。
- 服务默认仅允许本机来源访问 OAuth API，并限制 token 兑换频率。
- 不要把当前 OAuth 配置直接部署到公网环境。
