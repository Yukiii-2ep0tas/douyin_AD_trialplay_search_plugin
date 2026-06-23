# AGENT 使用说明

这份文档写给会操作文件、浏览器和终端的 Agent。

当前分支是公开发布分支。

推荐使用方式：

1. 直接分发 `public-dist/douyin-open-helper-public.zip`
2. 或者把当前仓库根目录作为已解压扩展目录加载

本分支已经移除了开发期测试脚本和内部工件。

目标：让 Agent 能独立安装、验证、更新和交付这款 Chrome 插件。

## 1. 插件定位

插件名称：

`抖音开放平台 - 登录与试玩管理助手`

主要能力：

1. 保存和恢复登录 Cookie
2. 抓取试玩管理列表的全部分页
3. 本地搜索 `AppID` 和试玩游戏名
4. 按发布状态、广告计划关联状态筛选
5. 在搜索结果中触发原网页的 `修改` / `显示日志` / `删除`
6. 在网页内通过悬浮按钮 `搜索助手` 展开嵌入面板

## 2. 运行环境要求

Agent 需要具备：

1. Chrome 或 Chromium 操作能力
2. 文件系统读写能力
3. 能访问：
   `https://developer.open-douyin.com/demogame/list?tab=demogameManage`
4. 如需自动化验证，还应具备 Playwright 能力

## 3. 公开发布版的最小文件集

公开交付只需要以下文件：

```text
manifest.json
background.js
content.js
popup.html
popup.js
icons/icon16.png
icons/icon48.png
icons/icon128.png
README.md
AGENT.md
```

下面这些属于开发期文件，不应进入公开发布包：

```text
node_modules/
scripts/
.trae/
package.json
package-lock.json
.DS_Store
```

## 4. 安装步骤

Agent 应指导用户或自己执行以下动作：

1. 打开 `chrome://extensions`
2. 开启 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择公开发布目录

如果 Agent 拿到的是 zip 包：

1. 先解压
2. 再选择解压后的目录

## 5. 首次配置

首次使用时，Agent 应按这个顺序操作：

1. 打开试玩管理页
2. 确认页面已经成功登录
3. 打开插件
4. 点击 `保存登录`
5. 点击 `开始抓取`
6. 等待状态变成 `抓取完成`

## 6. 标准使用流程

### 查询某个试玩

1. 确认已抓取过数据
2. 在搜索框输入 `AppID` 或试玩游戏名
3. 点击 `搜索`
4. 必要时设置筛选条件
5. 读取结果详情

### 执行修改或查看日志

1. 搜索到目标试玩
2. 点击结果项对应的 `修改` 或 `显示日志`
3. 如果是网页内嵌面板，面板会先自动关闭
4. 在原网页弹窗中继续操作

### 恢复登录

1. 打开插件
2. 点击 `恢复登录`
3. 刷新目标页
4. 检查是否恢复成功

## 7. 页面元素和行为约定

### 网页悬浮入口

- 文案：`搜索助手`
- 支持拖拽
- 点击切换展开 / 收起

### 数据抓取完成标志

插件界面中 `抓取状态` 应出现：

`抓取完成`

### 搜索结果

每条结果包含：

- 试玩游戏名
- AppID
- 发布状态
- 是否关联广告计划
- 所在页码
- 可执行动作

### 详情区

详情区显示结构化字段，不显示原始整行文本。

## 8. 自动化验证建议

如果 Agent 具备 Playwright，可优先执行：

```bash
npm run test:popup-ui
npm run test:embedded-action
```

含义：

- `test:popup-ui`：验证 popup 的基本布局、搜索和滚动
- `test:embedded-action`：验证网页内面板、悬浮按钮、动作执行和原网页弹窗交互

如果需要更完整审计，还可以执行：

```bash
npm run audit:demogame
```

## 9. 构建 public 发布包

开发分支中可用以下命令生成公开发布目录和 zip 包：

```bash
npm run build:public
```

输出目录约定：

```text
public-dist/
├── extension/
└── douyin-open-helper-public.zip
```

其中：

- `extension/` 用于 Chrome 直接加载已解压扩展
- `douyin-open-helper-public.zip` 用于分发

## 10. public 分支约定

`public` 分支的目标是公开交付，不是开发。

Agent 在这个分支上应遵守：

1. 仅保留用户安装和使用所需文件
2. 保留 `README.md` 和 `AGENT.md`
3. 不保留测试脚本和开发期工件
4. 不保留 `.trae/` 和 `node_modules/`
5. 可以保留 `public-dist/` 作为已构建产物

## 11. 故障排查规则

### 情况 1：按钮可见但点了没反应

优先检查：

1. 当前标签页是否仍是试玩管理页
2. 表格是否已加载完成
3. 是否已经先抓取数据

### 情况 2：搜索结果为空

优先检查：

1. 是否抓取成功
2. 搜索词是否正确
3. 是否筛选条件过严

### 情况 3：网页弹窗无法操作

优先检查：

1. 是否是旧版插件未重载
2. 面板是否在动作前自动关闭
3. 目标页 DOM 是否发生变化

### 情况 4：登录恢复失败

优先检查：

1. Cookie 是否已过期
2. 域名是否发生变化
3. 是否需要重新手动登录并再次 `保存登录`

## 12. 推荐交付话术

Agent 面向非技术用户时，建议只说三件事：

1. 去 `chrome://extensions` 加载插件目录
2. 先登录，再点 `保存登录`
3. 用 `开始抓取` 把试玩列表抓下来后再搜索

不要默认用户理解：

- Cookie
- 本地存储
- Manifest V3
- Content Script
- Service Worker

这些只在面向开发者时说明。
