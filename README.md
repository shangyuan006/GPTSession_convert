# GPTSession Convert

一个浏览器本地运行的 Session 格式转换工具，支持 GPT Session、CPA、Sub2API、Codex-Manager、AxonHub、9router 和 Cockpit 之间的格式转换，并提供 OpenAI OAuth 登录、回调和 `refresh_token` 生成流程。

![alt text](image.png)![alt text](image-1.png)

## 功能

- GPT Session 转换为 CPA、Sub2API、Codex-Manager、AxonHub、9router、Cockpit
- CPA、Sub2API、Codex-Manager、AxonHub、9router、Cockpit 之间互转
- 支持单条 JSON、JSON 数组和批量账号
- 支持拖拽 JSON 文件
- 支持选择多个 JSON 文件
- 支持选择本地目录导入 JSON
- 支持复制结果和下载 JSON
- 最近转换记录按每次实际的源格式和目标格式保存
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

需要 Node.js 18 或更高版本。

```powershell
cd GPTSession_convert
node server.js
```

然后访问：

```text
http://localhost:1455/
```

## 直接打开静态页面

直接打开 `index.html` 可以使用格式转换、文件导入、复制和下载功能。

OAuth 功能建议通过 `http://localhost:1455/` 使用，因为 OAuth 回调地址固定为：

```text
http://localhost:1455/auth/callback
```

## 端口配置

默认端口为 `1455`。Docker 部署时可以修改 `docker-compose.yml` 中的端口映射；如果修改了宿主机端口，OAuth 回调仍需要保持 `localhost:1455`，否则需要同步调整 OAuth Client 配置和页面中的回调地址。

## 安全说明

- Session、JSON 和转换结果默认在浏览器本地处理。
- OAuth 兑换由本地 `server.js` 代理到 OpenAI Token Endpoint。
- 本项目不包含数据库，不会主动保存账号和 token。
- 不建议把当前 OAuth 配置直接部署到公网环境。
