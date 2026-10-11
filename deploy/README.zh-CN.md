# 花火网页游戏：部署、备份与服务器重置恢复

这套目录用于把项目完整打包到本地，并在 Ubuntu 22.04 云服务器重置后快速恢复服务。发布包包含源码、依赖锁文件、全部网页美术资源、规则测试、部署配置和恢复脚本；不包含 `node_modules`、`.next`、服务器密码或其他凭据。

## 一、当前架构

- Next.js 16 同时提供网页、房间 API 和 Server-Sent Events 实时同步。
- Nginx 监听公网 `80` 端口，反向代理到本机 `127.0.0.1:3000`。
- systemd 服务名为 `fire-game.service`，应用目录为 `/opt/fire-game`。
- 每次部署保存在 `/opt/fire-game/releases/时间戳`，`/opt/fire-game/current` 指向当前版本。
- 房间、对局和聊天记录仅保存在 Node.js 进程内存中。服务器或服务重启会清空正在进行的房间，这不影响源码和美术资源恢复。

## 二、本地完整性

项目恢复所需的重要内容都在本地目录中：

- `src/`：页面、房间 API、游戏规则、实时同步和所有交互动效。
- `public/art/`：卡面、卡背、桌面/移动端背景、筹码、弃牌盘等美术资源。
- `docs/`：美术生成提示和原始参考资料。
- `scripts/`：双玩家联机冒烟测试。
- `deploy/`：打包、上传、全新安装、更新、健康检查和回滚脚本。
- `package-lock.json`：锁定 Node.js 依赖版本。

发布包创建后会同时生成同名 `.sha256` 校验文件，可确认备份没有损坏。

## 三、Windows 本地准备

需要：

- Node.js 22
- Windows OpenSSH Client（提供 `ssh.exe` 和 `scp.exe`）
- PowerShell 5.1 或更高版本

在项目根目录执行完整检查和打包：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-release.ps1
```

脚本依次执行测试、ESLint、生产构建，然后在 `.deploy-artifacts` 中生成：

```text
fire-game-release-YYYYMMDDHHMMSS.tar.gz
fire-game-release-YYYYMMDDHHMMSS.tar.gz.sha256
```

只想重新打包已验证代码时，可使用 `-SkipChecks`；正式备份建议保留完整检查。

## 四、服务器重置后的全新安装

服务器重装为 Ubuntu 22.04 后，确认 SSH 可以用 root 登录。然后在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\publish.ps1 `
  -HostName 154.217.234.218 `
  -Port 47742 `
  -UserName root `
  -Mode Install
```

命令会在本地重新检查和打包，上传发布包，然后自动完成：

1. 安装 Nginx、curl 和 Node.js 22。
2. 创建无登录权限的 `firegame` 系统用户。
3. 安装锁定依赖并在服务器再次运行 lint、测试和生产构建。
4. 安装 systemd 与 Nginx 配置。
5. 启动服务并检查 Next.js 与公网入口。

SSH/SCP 会在终端中提示输入密码。密码不会写入脚本、发布包或本文档。

成功时终端会显示 `DEPLOYMENT_OK` 和 `HEALTH_OK`。随后访问：

```text
http://154.217.234.218/
```

如果服务器 SSH 端口或 IP 发生变化，只需修改命令参数。

## 五、已有服务器的日常更新

服务器没有重置、原服务仍然完整时使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\publish.ps1 `
  -HostName 154.217.234.218 `
  -Port 47742 `
  -UserName root `
  -Mode Update
```

更新脚本会创建新版本目录、重新验证项目、更新 systemd/Nginx 配置、切换软链接并执行健康检查。失败时会自动恢复原版本和原配置。

## 六、使用已有发布包

如果已经有经过校验的归档，可避免再次构建：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\publish.ps1 `
  -HostName 154.217.234.218 `
  -Port 47742 `
  -Mode Install `
  -ArchivePath .\.deploy-artifacts\fire-game-release-YYYYMMDDHHMMSS.tar.gz
```

发布前可验证哈希：

```powershell
Get-FileHash -Algorithm SHA256 .\.deploy-artifacts\fire-game-release-YYYYMMDDHHMMSS.tar.gz
```

将输出和相邻 `.sha256` 文件中的值比较。

## 七、手动恢复方式

如果无法使用 `publish.ps1`，先上传发布包和引导脚本：

```powershell
scp -P 47742 .\.deploy-artifacts\fire-game-release-YYYYMMDDHHMMSS.tar.gz root@154.217.234.218:/tmp/
scp -P 47742 .\deploy\server-bootstrap.sh root@154.217.234.218:/tmp/
ssh -p 47742 root@154.217.234.218
```

进入服务器后执行：

```bash
bash /tmp/server-bootstrap.sh /tmp/fire-game-release-YYYYMMDDHHMMSS.tar.gz YYYYMMDDHHMMSS
```

## 八、检查服务和查看日志

```bash
bash /opt/fire-game/current/deploy/server-health.sh
systemctl status fire-game.service --no-pager
journalctl -u fire-game.service -n 150 --no-pager
nginx -t
tail -n 100 /var/log/nginx/error.log
```

服务器目录：

```text
/opt/fire-game/current                 当前版本软链接
/opt/fire-game/releases/               所有已部署版本
/etc/systemd/system/fire-game.service  Node 服务配置
/etc/nginx/sites-available/fire-game   Nginx 配置
```

## 九、回滚

列出可回滚版本：

```bash
find /opt/fire-game/releases -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r
```

回滚到指定版本：

```bash
bash /opt/fire-game/current/deploy/server-rollback.sh YYYYMMDDHHMMSS
```

脚本会切换版本、重启并健康检查；目标版本无法启动时会恢复回滚前版本。

## 十、已知边界

- 当前只提供 HTTP。若以后绑定域名，可再增加 HTTPS 证书，不影响应用发布包。
- 全新安装需要服务器能访问 Ubuntu apt、NodeSource 和 npm registry；源码与美术无需从其他仓库下载。
- 对局状态没有数据库持久化，部署或重启前应先结束正在进行的牌局。
- 发布脚本不会保存 SSH 密码。服务器重置后若密码、IP 或端口变化，在命令参数和交互式密码提示中使用新值即可。
