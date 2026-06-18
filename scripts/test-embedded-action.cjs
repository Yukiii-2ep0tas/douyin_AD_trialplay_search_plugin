const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = PROJECT_ROOT;
const TARGET_URL = 'https://developer.open-douyin.com/demogame/list?tab=demogameManage';
const COOKIE_FILE = path.join(PROJECT_ROOT, '.trae', 'artifacts', 'playwright-demogame', 'open-douyin-cookies.json');
const TABLE_SELECTOR = 'table.semi-dy-open-table[role="treegrid"]';
const DIALOG_SELECTOR = '[role="dialog"], .semi-dy-open-modal, .semi-modal, .semi-dy-open-portal';

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function restorePersistedCookies(context) {
  const savedCookies = readJsonFile(COOKIE_FILE);
  if (!Array.isArray(savedCookies) || !savedCookies.length) {
    throw new Error('未找到可复用的 Cookie 持久化文件');
  }
  await context.addCookies(savedCookies);
}

async function getExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  return serviceWorker.url().split('/')[2];
}

async function openEmbeddedPanel(page) {
  await page.waitForFunction(() => {
    const host = document.getElementById('douyin-open-helper-host');
    return Boolean(host && host.shadowRoot && host.shadowRoot.getElementById('helperFab'));
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const host = document.getElementById('douyin-open-helper-host');
    host.shadowRoot.getElementById('helperFab').click();
  });

  await page.waitForFunction(() => {
    const host = document.getElementById('douyin-open-helper-host');
    const panel = host?.shadowRoot?.getElementById('helperPanel');
    return Boolean(panel && panel.classList.contains('open'));
  }, { timeout: 10000 });
}

async function assertFabLabelAndDrag(page) {
  const before = await page.evaluate(() => {
    const host = document.getElementById('douyin-open-helper-host');
    const fab = host?.shadowRoot?.getElementById('helperFab');
    const dock = host?.shadowRoot?.querySelector('.dock');
    if (!fab || !dock) {
      return null;
    }
    const fabRect = fab.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    return {
      text: fab.textContent || '',
      fabCenterX: fabRect.left + fabRect.width / 2,
      fabCenterY: fabRect.top + fabRect.height / 2,
      left: dockRect.left,
      top: dockRect.top,
    };
  });

  if (!before) {
    throw new Error('未找到悬浮按钮');
  }

  if (before.text.trim() !== '搜索助手') {
    throw new Error(`悬浮按钮文案异常: ${before.text}`);
  }

  await page.mouse.move(before.fabCenterX, before.fabCenterY);
  await page.mouse.down();
  await page.mouse.move(before.fabCenterX - 120, before.fabCenterY - 80, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const host = document.getElementById('douyin-open-helper-host');
    const dock = host?.shadowRoot?.querySelector('.dock');
    if (!dock) {
      return null;
    }
    const dockRect = dock.getBoundingClientRect();
    return {
      left: dockRect.left,
      top: dockRect.top,
    };
  });

  if (!after) {
    throw new Error('拖拽后未找到悬浮按钮容器');
  }

  if (Math.abs(after.left - before.left) < 40 && Math.abs(after.top - before.top) < 30) {
    throw new Error(`悬浮按钮拖拽后位置变化不足: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
  }
}

async function waitForEmbeddedFrame(page, extensionId) {
  await page.waitForFunction((expectedOrigin) => {
    const host = document.getElementById('douyin-open-helper-host');
    const iframe = host?.shadowRoot?.querySelector('iframe');
    return Boolean(iframe && iframe.src.startsWith(expectedOrigin));
  }, `chrome-extension://${extensionId}/`, { timeout: 10000 });

  const frame = page.frames().find((item) => item.url().startsWith(`chrome-extension://${extensionId}/popup.html`));
  if (!frame) {
    throw new Error('未找到网页内嵌的 popup iframe');
  }
  return frame;
}

async function assertPanelClosed(page) {
  const closed = await page.evaluate(() => {
    const host = document.getElementById('douyin-open-helper-host');
    const panel = host?.shadowRoot?.getElementById('helperPanel');
    return Boolean(panel && !panel.classList.contains('open'));
  });
  if (!closed) {
    throw new Error('执行动作后网页内悬浮面板未自动关闭');
  }
}

async function assertPanelInsideViewport(page) {
  const layout = await page.evaluate(() => {
    const host = document.getElementById('douyin-open-helper-host');
    const panel = host?.shadowRoot?.getElementById('helperPanel');
    if (!panel) {
      return null;
    }
    const rect = panel.getBoundingClientRect();
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  if (!layout) {
    throw new Error('未找到网页内悬浮面板节点');
  }

  if (
    layout.top < 0
    || layout.left < 0
    || layout.right > layout.viewportWidth
    || layout.bottom > layout.viewportHeight
  ) {
    throw new Error(
      `悬浮面板超出视口: rect=${JSON.stringify(layout)}`
    );
  }
}

async function assertDialogInteractive(page) {
  const dialog = page.locator(`${DIALOG_SELECTOR}:visible`).filter({
    has: page.locator('input, textarea, [contenteditable="true"], button'),
  }).first();

  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  const input = dialog.locator(
    'input:not([disabled]):not([type="hidden"]), ' +
    'textarea:not([disabled]), ' +
    '[contenteditable="true"]'
  ).first();

  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.click();

  const focused = await input.evaluate((node) => node === document.activeElement || node.contains(document.activeElement));
  if (!focused) {
    throw new Error('原网页弹窗中的输入框无法被点击聚焦');
  }

  const cancelButton = dialog.getByRole('button', { name: /取消|关闭/ }).first();
  if (await cancelButton.count()) {
    await cancelButton.click();
  }
}

async function waitForEmbeddedCrawl(frame) {
  const result = await frame.evaluate(async () => {
    const isTargetPageUrl = (url) => {
      try {
        const parsed = new URL(url);
        return parsed.hostname.includes('developer.open-douyin.com')
          && parsed.pathname === '/demogame/list'
          && parsed.searchParams.get('tab') === 'demogameManage';
      } catch (error) {
        return false;
      }
    };

    const getPageInfo = (tabId) => new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    });

    const allTabs = await chrome.tabs.query({});
    const candidates = allTabs.filter((tab) => isTargetPageUrl(tab.url || ''));
    let targetTab = null;

    for (const tab of candidates) {
      const pageInfo = await getPageInfo(tab.id);
      if (pageInfo?.isTargetPage && pageInfo?.hasTable) {
        targetTab = tab;
        break;
      }
    }

    if (!targetTab?.id) {
      return { success: false, error: '未找到可抓取的试玩管理页标签' };
    }

    return new Promise((resolve) => {
      chrome.tabs.sendMessage(targetTab.id, { action: 'startDemogameCrawl' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || null);
      });
    });
  });

  if (!result?.success) {
    throw new Error(result?.error || result?.message || '嵌入面板抓取失败');
  }

  await frame.waitForFunction(() => {
    const node = document.getElementById('crawlStatus');
    return node && /抓取完成/.test(node.textContent || '');
  }, { timeout: 120000 });
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-embedded-action-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    await getExtensionId(context);
    await restorePersistedCookies(context);

    const page = await context.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(TABLE_SELECTOR, { timeout: 20000 });
    await assertFabLabelAndDrag(page);
    await openEmbeddedPanel(page);
    await assertPanelInsideViewport(page);

    const extensionId = await getExtensionId(context);
    const frame = await waitForEmbeddedFrame(page, extensionId);

    await waitForEmbeddedCrawl(frame);
    await frame.fill('#searchKeyword', '三角形');
    await frame.click('#btnSearch');
    await frame.waitForTimeout(500);
    await frame.locator('.result-item [data-action-key="edit"]').first().click();

    await page.waitForTimeout(500);
    await assertPanelClosed(page);
    await assertDialogInteractive(page);

    console.log('embedded action test ok');
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
