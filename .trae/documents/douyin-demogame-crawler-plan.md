# 抖音试玩管理列表抓取与检索扩展实施计划

## Summary

在现有“登录持久化”Chrome 扩展基础上，扩展出两条新增能力：

1. 在 `https://developer.open-douyin.com/demogame/list?tab=demogameManage` 页面内，从当前已登录标签页手动触发抓取，自动点击分页 `li` 的下一页按钮，遍历试玩管理列表，抽取全部列表项文本并结构化存储为 JSON。
2. 在插件 popup 内基于本地已存 JSON 数据，支持按 `AppID` 和“试玩游戏名”搜索，返回命中项所在页码及详细字段信息。

本次实现以“运行在当前活动标签页的 content script + background 统一存储/查询 + popup 交互界面”为主。Playwright MCP 在执行阶段仅用于页面结构核对和选择器验证，不作为正式抓取链路，因为正式抓取必须复用用户当前浏览器中的登录态。

## Current State Analysis

### 已探索到的现状

- 仓库当前文件：
  - `manifest.json`
  - `background.js`
  - `popup.html`
  - `popup.js`
  - `content.js`
  - `icons/*`
- 当前扩展定位为“登录持久化助手”，已有能力仅包括：
  - Cookie 保存/恢复/清除
  - 当前登录状态检测
  - popup 中展示登录状态
- 当前代码中没有以下能力：
  - 列表抓取
  - 分页遍历
  - 结构化 JSON 存储
  - 搜索索引
  - 搜索结果展示
- 页面侧已知线索：
  - 用户提供的下一页按钮节点为 `li[aria-label="Next"]`
  - 该按钮当前类名包含 `semi-dy-open-page-next`
  - 目标页面为 `developer.open-douyin.com/demogame/list?tab=demogameManage`
- 可用 MCP 能力已确认：
  - `mcp_Playwright` 支持 `playwright_navigate`、`playwright_click`、`playwright_get_visible_html`、`playwright_get_visible_text`、`playwright_evaluate`、`playwright_screenshot`
  - 可用于执行阶段验证目标页面 DOM 结构和选择器，但不应替代扩展在当前已登录标签页内抓取

### 现有代码对新增目标的影响

- `manifest.json`
  - 已具备 `storage`、`activeTab`、`scripting` 权限和 `*.open-douyin.com` host 权限，具备继续扩展的基础
  - 需要补充/调整权限与扩展描述，以支持 popup 与当前标签页通信、抓取状态展示
- `background.js`
  - 当前仅管理登录 Cookie 和登录状态
  - 适合作为新增抓取结果、索引、抓取元信息的统一持久化入口
- `content.js`
  - 当前只有页面信息读取和简单 DOM 观察
  - 需要升级为真正的页面抓取执行器
- `popup.html` / `popup.js`
  - 当前只有登录状态操作界面
  - 需要重构为“登录状态 + 抓取操作 + 搜索入口 + 结果详情”的组合界面

## Assumptions & Decisions

### 用户已确认的产品决策

- 抓取触发方式：`手动点击抓取`
- 搜索规则：`AppID 精确匹配 + 试玩游戏名包含匹配`
- 存储方式：`仅插件本地存储（chrome.storage.local）`
- 结构化方式：`严格字段化`
- JSON Schema 形态：`核心字段 + 动态字段`

### 本次实现固定采用的技术决策

- 正式抓取链路放在 `content.js`，原因：
  - 只有 content script 运行在当前真实登录页面内，能稳定复用用户登录态和当前页面渲染后的 DOM
  - background/service worker 不直接操作页面 DOM
  - Playwright 独立浏览器上下文不适合作为正式抓取通道
- background 负责统一存储和查询：
  - 保存抓取快照
  - 保存抓取时间、总页数、总条数
  - 生成/维护搜索索引
  - 响应 popup 的搜索请求
- popup 只负责触发、展示和搜索，不直接解析 DOM
- 数据模型采用“固定核心字段 + 动态字段字典”：
  - 固定字段：`appId`、`gameName`、`pageNo`、`itemIndex`、`rawText`、`fields`、`capturedAt`
  - `fields` 保存页面上其余标签化字段
  - 若执行阶段识别到稳定字段（如状态、类目、时间等），可再提升为固定字段，但不改变上述基础模型

## Proposed Changes

### 1. `manifest.json`

#### 变更内容

- 更新扩展名称、描述，使其反映“登录持久化 + 试玩管理抓取/搜索”的双重能力
- 补充 popup 与活动标签页通信所需权限配置
- 维持 `content_scripts` 注入到 `*.open-douyin.com/*`

#### 具体实现

- 保留现有：
  - `cookies`
  - `storage`
  - `activeTab`
  - `scripting`
  - `host_permissions` 中的 `*.open-douyin.com`
- 执行阶段验证是否需要增加 `tabs` 权限；如果 popup 与当前 tab 的查询/发送消息在现有权限下存在限制，则补加

#### 原因

- 当前 manifest 能承接改造，但需要显式覆盖新增交互和页面通信场景

### 2. `background.js`

#### 变更内容

在保留现有登录持久化逻辑的基础上，新增抓取数据存储、索引构建和搜索接口。

#### 新增存储键

- `demogame_dataset`
  - 保存最近一次完整抓取快照
- `demogame_search_index`
  - 保存搜索辅助索引
- `demogame_crawl_status`
  - 保存抓取状态（空闲/抓取中/成功/失败）和最近执行摘要

#### 建议数据结构

```json
{
  "version": 1,
  "source": {
    "url": "https://developer.open-douyin.com/demogame/list?tab=demogameManage"
  },
  "capturedAt": 0,
  "totalPages": 0,
  "totalItems": 0,
  "items": [
    {
      "id": "appId-pageNo-itemIndex",
      "appId": "123456",
      "gameName": "示例试玩游戏",
      "pageNo": 1,
      "itemIndex": 0,
      "rawText": "该列表项的完整可见文本",
      "fields": {
        "AppID": "123456",
        "试玩游戏名": "示例试玩游戏"
      },
      "capturedAt": 0
    }
  ]
}
```

#### 新增消息动作

- `setCrawlStatus`
- `saveDemogameDataset`
- `getDemogameDatasetSummary`
- `searchDemogameItems`
- `getDemogameItemDetail`
- `clearDemogameDataset`

#### 搜索规则

- AppID：
  - 若用户输入 AppID，则执行精确匹配
- 试玩游戏名：
  - 执行不区分大小写的包含匹配
- 当两个条件同时存在时：
  - 采用 AND 过滤
- 结果排序：
  - 先按 `pageNo` 升序，再按 `itemIndex` 升序

#### 原因

- popup 需要轻量，background 适合持有统一状态和响应多入口读写

### 3. `content.js`

#### 变更内容

将其从“仅观察页面”升级为真正的列表抓取执行器。

#### 关键职责

- 校验当前页面是否为试玩管理列表页
- 定位试玩管理列表容器和当前页的全部列表项
- 从每个列表项中抽取字段
- 自动点击下一页 `li`
- 检测翻页完成和最后一页
- 将完整结果回传 background 存储

#### 抓取流程

1. popup 发起 `startDemogameCrawl`
2. popup 通过 `chrome.tabs.sendMessage` 发送到当前活动标签页
3. `content.js` 校验 URL 和页面状态
4. 抓取当前页全部列表项
5. 将每个列表项解析为结构化记录：
   - 优先通过页面标签文本抽取 `AppID`、`试玩游戏名`
   - 其余标签进入 `fields`
   - 同时保留 `rawText`
6. 判断下一页按钮是否可点击：
   - 优先用 `li[aria-label="Next"]`
   - 兼容类名 `.semi-dy-open-page-next`
   - 通过 `aria-disabled`/类名状态判断是否已到最后一页
7. 点击后等待列表内容变化，再继续抓取下一页
8. 直到下一页不可点击，汇总总页数和总条数
9. 将完整数据发给 background 保存

#### 选择器策略

- 分页下一页按钮：
  - 首选：`li[aria-label="Next"]`
  - 备选：`li.semi-dy-open-page-next`
- 列表区与列表项：
  - 执行阶段先用 Playwright MCP/当前页 DOM 检查真实结构
  - 最终代码采用“主选择器 + 备选选择器数组”的容错方案
- 字段解析：
  - 优先用标签-值相邻关系提取
  - 若 DOM 结构不规则，则退化为按多行文本配对解析

#### 稳定性处理

- 为每页抓取增加超时和失败上报
- 翻页后通过以下任一条件确认页面已切换：
  - 当前列表首项文本变化
  - 当前页码变化
  - 列表容器 DOM 发生更新
- 对重复项做去重，避免翻页回流或重复触发导致重复记录

#### 原因

- 所有真实 DOM 抓取都必须在当前页面上下文中执行

### 4. `popup.html`

#### 变更内容

将现有单一登录状态面板重构为多分区界面。

#### 新界面分区

- 登录状态区
  - 保留现有保存/恢复 Cookie 能力
- 抓取控制区
  - “开始抓取试玩管理列表”
  - “清空已抓取数据”
  - 最近抓取时间 / 总页数 / 总条数 / 抓取状态
- 搜索区
  - AppID 输入框
  - 试玩游戏名输入框
  - 搜索按钮 / 清空条件按钮
- 结果区
  - 结果数量
  - 每项显示：
    - AppID
    - 试玩游戏名
    - 页码
    - 简要字段摘要
- 详情区
  - 点击结果项后展示完整 `fields` 与 `rawText`

#### 原因

- 当前 popup 空间有限，必须用结构化分区支持操作链路闭环

### 5. `popup.js`

#### 变更内容

新增抓取触发、状态刷新、搜索查询、结果渲染、详情展示逻辑，并保留现有登录持久化逻辑。

#### 关键逻辑

- 识别当前活动 tab 是否是目标页面
- 点击“开始抓取”时：
  - 禁用按钮
  - 显示进度状态
  - 向当前 tab 发送抓取命令
  - 抓取完成后刷新摘要
- 搜索时：
  - 读取用户输入
  - 发送到 background 的 `searchDemogameItems`
  - 渲染结果列表
- 点击结果项时：
  - 展示结构化详情

#### 交互要求

- 在未抓取数据时，搜索区需要明显提示“请先抓取”
- 在非目标页面打开 popup 时，抓取按钮应禁用并提示必须切到试玩管理页面
- 抓取过程中展示“抓取中，请勿手动翻页”的状态提示

#### 原因

- popup 是用户唯一操作入口，必须承担完整的控制与反馈职责

## Execution Notes

执行阶段先做一轮页面结构核对，再开始正式编码：

1. 用当前已登录页面 + Playwright MCP 只读检查列表 DOM 和分页 DOM
2. 锁定列表项、字段标签、页码、下一页按钮的最终选择器
3. 再按本计划修改上述 5 个文件

这样可以保证“严格字段化”不是靠猜测，而是根据真实页面结构落地。

## Verification Steps

### 功能验证

1. 加载扩展到 Chrome 开发者模式
2. 打开并登录目标页面：
   - `https://developer.open-douyin.com/demogame/list?tab=demogameManage`
3. 在 popup 中点击“开始抓取试玩管理列表”
4. 验证：
   - 自动从当前页开始逐页翻页
   - 到最后一页自动停止
   - background 中成功保存抓取快照
   - popup 显示总页数、总条数、最近抓取时间
5. 用已知 `AppID` 搜索：
   - 仅返回 AppID 完全相等的记录
6. 用试玩游戏名关键词搜索：
   - 返回名称包含关键词的记录
7. 同时输入 AppID 和试玩游戏名：
   - 只返回同时满足两个条件的记录
8. 点击结果项：
   - 正确展示页码和结构化详情

### 边界验证

1. 当前页不是目标页面时：
   - 抓取入口不可执行，并有清晰提示
2. 页面列表为空时：
   - 抓取返回空结果，不报错
3. 仅一页数据时：
   - 不点击下一页也能完成抓取
4. 某页字段缺失时：
   - 保留 `rawText`
   - 缺失字段置空或不写入 `fields`
5. 翻页失败或 DOM 未更新时：
   - 显示失败状态和错误摘要，不写入脏数据覆盖旧快照

### 验收标准

- 用户能在插件里一次手动触发全量抓取
- 抓取结果本地持久化为结构化 JSON
- 能按 AppID 和试玩游戏名搜索
- 搜索结果带页码和完整详情
- 在页面结构轻微变动时仍具备一定容错能力
