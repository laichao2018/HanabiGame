# 花火在线

一个支持 2–5 人实时联机的中文花火网页游戏。包含账号、历史统计、断线重连、聊天和标准五色规则。

## 本地开发

要求 Node.js 22+。

```bash
cp .env.example .env
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。开发服务器 API 为 `http://localhost:3001`。

## 检查与构建

```bash
npm run check
npm run build
```

## 单服务器部署

一键脚本支持 macOS，以及 CentOS/RHEL/Rocky/AlmaLinux、Fedora、Ubuntu/Debian 和 Amazon Linux。它会自动检测系统、局域网 IP、磁盘、可用端口、Docker 和 Compose，按需安装并启动环境，生成随机签名密钥，构建服务，配置常见 Linux 防火墙并完成健康检查。

macOS 使用普通用户运行（不要加 `sudo`）：

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

CentOS 等 Linux 服务器也可直接运行；需要安装系统包时脚本会调用 `sudo`：

```bash
./scripts/deploy.sh
```

未指定端口时，脚本从 `8080–8180` 自动选择可用端口。部署完成会打印 `http://本机IP:端口`。需要固定端口时使用 `./scripts/deploy.sh --port 9527`。

脚本启动成功后会退出，服务继续在 Docker 后台运行。停止服务：

```bash
./scripts/deploy.sh --stop
```

再次执行 `./scripts/deploy.sh` 会先清理旧容器，再构建和启动新版本。停止和重新部署都不会删除 `hanabi_data` 数据卷，因此账号、房间与历史记录会保留。

先查看将执行的操作而不修改系统：

```bash
./scripts/deploy.sh --dry-run
```

重复执行同一命令即可升级应用；`hanabi_data` 持久卷不会被覆盖。完整参数参见 `./scripts/deploy.sh --help`。

### 手动部署

先构建网页静态文件，再启动 Compose：

```bash
npm ci
npm run build
JWT_SECRET='至少 32 位随机字符串' PUBLIC_ORIGIN='http://本机IP:8080' HANABI_HTTP_PORT=8080 docker compose up -d --build
```

用户、活动房间和历史记录保存在 `hanabi_data` 持久卷中。请定期备份该卷内的 `hanabi.json`。

## 项目结构

- `apps/web`：React 网页客户端
- `apps/server`：Fastify + Socket.IO 服务
- `packages/game-engine`：服务端权威规则引擎
- `packages/protocol`：共享请求校验和类型
- `docs/architecture.md`：完整架构和验收设计
