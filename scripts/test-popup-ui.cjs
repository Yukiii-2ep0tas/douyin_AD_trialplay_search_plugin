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
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: `mock-${index + 1}`,
    appId: `ttmockappid${String(index + 1).padStart(3, '0')}`,
    gameName: index === 0 ? '三角形行动' : `试玩测试游戏${index + 1}`,
    pageNo: 2,
    itemIndex: index,
    fields: {
      'App ID': `ttmockappid${String(index + 1).padStart(3, '0')}`,
      '试玩游戏名': index === 0 ? '三角形行动' : `试玩测试游戏${index + 1}`,
      '发布状态': index % 2 === 0 ? '已上线' : '未发布',
      '是否关联广告计划': index % 2 === 0 ? '否' : '是',
      'MaterialID': index === 0 ? '123456789' : String(123456789 + index),
      '描述': `mock 描述 ${index + 1}`,
    },
    operations: [
      { key: 'edit', label: '修改', clickable: true, href: null, hrefAttr: null, executionMode: 'dom-click' },
      { key: 'delete', label: '删除', clickable: index % 3 !== 0, href: null, hrefAttr: null, executionMode: 'dom-click' },
      { key: 'changeLog', label: '变更日志', clickable: true, href: null, hrefAttr: null, executionMode: 'dom-click' },
    ],
  }));

  const payload = {
    version: 1,
    source: {
      url: 'https://developer.open-douyin.com/demogame/list?tab=demogameManage',
    },
    capturedAt: Date.now(),
    totalPages: 2,
    totalItems: items.length,
    items,
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
    await page.click('#btnSearch');
    await page.waitForTimeout(400);

    const toolbarVisibleAfter = await page.locator('#filterToolbar').evaluate((node) => node.classList.contains('visible'));
    if (!toolbarVisibleAfter) {
      throw new Error('搜索后应显示筛选器');
    }

    const allResultItems = await page.locator('.result-item').count();
    if (allResultItems !== 8) {
      throw new Error(`空搜索应展示全部结果，实际只有 ${allResultItems} 条`);
    }

    await page.selectOption('#filterPublishStatus', '已上线');
    await page.waitForTimeout(300);

    const filteredResultItems = await page.locator('.result-item').count();
    if (filteredResultItems !== 4) {
      throw new Error(`空搜索后按发布状态筛选应得到 4 条结果，实际为 ${filteredResultItems} 条`);
    }

    const resultText = await page.locator('#resultList').innerText();
    if (!resultText.includes('试玩测试游戏3') || !resultText.includes('显示日志')) {
      throw new Error('空搜索后的筛选结果未正确显示游戏名和行内动作按钮');
    }

    const detailText = await page.locator('#detailFields').innerText();
    if (detailText.includes('原始文本')) {
      throw new Error('详情区不应显示原始文本');
    }

    const scrollInfo = await page.evaluate(() => ({
      overflowY: window.getComputedStyle(document.body).overflowY,
      bodyScrollHeight: document.body.scrollHeight,
      innerHeight: window.innerHeight,
      resultOverflowY: window.getComputedStyle(document.getElementById('resultList')).overflowY,
    }));

    if (scrollInfo.overflowY === 'hidden') {
      throw new Error('popup 主体不应禁止纵向滚动');
    }

    if (scrollInfo.resultOverflowY === 'auto') {
      throw new Error('结果列表不应继续单独占用滚动容器');
    }

    if (scrollInfo.bodyScrollHeight <= scrollInfo.innerHeight) {
      throw new Error('搜索结果较多时，popup 主体应产生可滚动高度');
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
