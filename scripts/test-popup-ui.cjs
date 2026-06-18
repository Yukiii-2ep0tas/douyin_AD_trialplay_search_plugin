const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = PROJECT_ROOT;

async function getExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  return serviceWorker.url().split('/')[2];
}

async function seedMockData(page) {
  const payload = {
    version: 1,
    source: {
      url: 'https://developer.open-douyin.com/demogame/list?tab=demogameManage',
    },
    capturedAt: Date.now(),
    totalPages: 2,
    totalItems: 2,
    items: [
      {
        id: 'mock-1',
        appId: 'ttmockappid001',
        gameName: '三角形行动',
        pageNo: 2,
        itemIndex: 0,
        fields: {
          'App ID': 'ttmockappid001',
          '试玩游戏名': '三角形行动',
          '发布状态': '已上线',
          '是否关联广告计划': '否',
          'MaterialID': '123456789',
          '描述': 'mock 描述',
        },
        operations: [
          { key: 'edit', label: '修改', clickable: true, href: null, hrefAttr: null, executionMode: 'dom-click' },
          { key: 'delete', label: '删除', clickable: false, href: null, hrefAttr: null, executionMode: 'dom-click' },
          { key: 'changeLog', label: '变更日志', clickable: true, href: null, hrefAttr: null, executionMode: 'dom-click' },
        ],
      },
      {
        id: 'mock-2',
        appId: 'ttmockappid002',
        gameName: '商业化试玩',
        pageNo: 2,
        itemIndex: 1,
        fields: {
          'App ID': 'ttmockappid002',
          '试玩游戏名': '商业化试玩',
          '发布状态': '未发布',
          '是否关联广告计划': '是',
          'MaterialID': '-',
          '描述': '另一条 mock',
        },
        operations: [
          { key: 'edit', label: '修改', clickable: true, href: null, hrefAttr: null, executionMode: 'dom-click' },
          { key: 'delete', label: '删除', clickable: true, href: null, hrefAttr: null, executionMode: 'dom-click' },
          { key: 'changeLog', label: '变更日志', clickable: true, href: null, hrefAttr: null, executionMode: 'dom-click' },
        ],
      },
    ],
  };

  await page.evaluate(async (dataset) => {
    await chrome.storage.local.set({
      demogame_dataset: dataset,
      demogame_crawl_status: {
        state: 'success',
        message: `抓取完成，共 ${dataset.totalPages} 页，${dataset.totalItems} 条`,
        updatedAt: Date.now(),
        sourceUrl: dataset.source.url,
        pageNo: dataset.totalPages,
        totalPages: dataset.totalPages,
        totalItems: dataset.totalItems,
        error: '',
      },
    });
  }, payload);
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-popup-ui-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await seedMockData(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);

    const collapsed = await page.evaluate(() => document.body.classList.contains('login-collapsed'));
    if (!collapsed) {
      throw new Error('登录卡片默认应折叠');
    }

    const toolbarVisibleBefore = await page.locator('#filterToolbar').evaluate((node) => node.classList.contains('visible'));
    if (toolbarVisibleBefore) {
      throw new Error('搜索前不应显示筛选器');
    }

    await page.click('#btnToggleLogin');
    const loginVisible = await page.locator('#sectionLogin').isVisible();
    if (!loginVisible) {
      throw new Error('点击开关后登录卡片未显示');
    }

    await page.click('#btnToggleLogin');
    await page.fill('#searchKeyword', '三角形');
    await page.click('#btnSearch');
    await page.waitForTimeout(400);

    const toolbarVisibleAfter = await page.locator('#filterToolbar').evaluate((node) => node.classList.contains('visible'));
    if (!toolbarVisibleAfter) {
      throw new Error('搜索后应显示筛选器');
    }

    const resultText = await page.locator('#resultList').innerText();
    if (!resultText.includes('三角形行动') || !resultText.includes('显示日志')) {
      throw new Error('搜索结果未正确显示游戏名和行内动作按钮');
    }

    const detailText = await page.locator('#detailFields').innerText();
    if (detailText.includes('原始文本')) {
      throw new Error('详情区不应显示原始文本');
    }

    console.log('popup ui test ok');
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
