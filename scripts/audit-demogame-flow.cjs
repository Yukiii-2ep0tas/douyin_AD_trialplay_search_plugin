const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = PROJECT_ROOT;
const TARGET_URL = 'https://developer.open-douyin.com/demogame/list?tab=demogameManage';
const ARTIFACT_DIR = path.join(PROJECT_ROOT, '.trae', 'artifacts', 'playwright-demogame');
const COOKIE_FILE = path.join(ARTIFACT_DIR, 'open-douyin-cookies.json');
const TABLE_SELECTOR = 'table.semi-dy-open-table[role="treegrid"]';
const PAGE_ROW_SELECTOR = 'tbody tr.semi-dy-open-table-row';
const PAGE_CELL_SELECTOR = 'td.semi-dy-open-table-row-cell';
const DIALOG_SELECTOR = '[role="dialog"], .semi-dy-open-modal, .semi-modal, .semi-dy-open-portal';

function logStep(step, detail) {
  const prefix = `[AUDIT ${new Date().toISOString()}]`;
  console.log(`${prefix} ${step}${detail ? ` | ${detail}` : ''}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function screenshot(page, name) {
  ensureDir(ARTIFACT_DIR);
  const filePath = path.join(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function waitForTableOrManualLogin(page) {
  try {
    await page.waitForSelector(TABLE_SELECTOR, { timeout: 15000 });
    return false;
  } catch (error) {
    logStep('等待人工登录', '当前页面未直接进入试玩管理列表，请在打开的 Chromium 窗口中完成登录');
    await page.waitForFunction(
      ({ tableSelector }) => Boolean(document.querySelector(tableSelector)),
      { tableSelector: TABLE_SELECTOR },
      { timeout: 10 * 60 * 1000 }
    );
    return true;
  }
}

async function restorePersistedCookies(context) {
  const savedCookies = readJsonFile(COOKIE_FILE);
  if (!Array.isArray(savedCookies) || !savedCookies.length) {
    return { restored: false, count: 0 };
  }
  await context.addCookies(savedCookies);
  return { restored: true, count: savedCookies.length };
}

async function persistCurrentCookies(context) {
  const cookies = await context.cookies();
  const filtered = cookies.filter((cookie) =>
    /(^|\.)open-douyin\.com$/.test(cookie.domain) || /(^|\.)douyin\.com$/.test(cookie.domain)
  );
  writeJsonFile(COOKIE_FILE, filtered);
  return { count: filtered.length, filePath: COOKIE_FILE };
}

function isTargetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('developer.open-douyin.com')
      && parsed.pathname === '/demogame/list'
      && parsed.searchParams.get('tab') === 'demogameManage';
  } catch (error) {
    return false;
  }
}

async function resolveReadyTargetPage(context, initialPage) {
  const hasTable = async (page) => {
    try {
      return await page.locator(TABLE_SELECTOR).count() > 0;
    } catch (error) {
      return false;
    }
  };

  const pickReadyPage = async () => {
    for (const page of context.pages()) {
      if (!isTargetUrl(page.url())) {
        continue;
      }
      if (await hasTable(page)) {
        return page;
      }
    }
    return null;
  };

  const directHit = await pickReadyPage();
  if (directHit) {
    return { page: directHit, neededManualLogin: false };
  }

  try {
    await initialPage.waitForSelector(TABLE_SELECTOR, { timeout: 15000 });
    return { page: initialPage, neededManualLogin: false };
  } catch (error) {
    logStep('等待人工登录', '当前页面未直接进入试玩管理列表，请在打开的 Chromium 窗口中完成登录');

    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const readyPage = await pickReadyPage();
      if (readyPage) {
        await readyPage.bringToFront();
        return { page: readyPage, neededManualLogin: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('等待人工登录超时，未找到已就绪的试玩管理页面');
  }
}

async function getExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  return serviceWorker.url().split('/')[2];
}

async function extractCurrentPageRows(page) {
  return page.evaluate(({ rowSelector, cellSelector }) => {
    return Array.from(document.querySelectorAll(rowSelector)).map((row) => {
      const cells = Array.from(row.querySelectorAll(cellSelector)).map((cell) =>
        String(cell.innerText || '').replace(/\s+/g, ' ').trim()
      );
      return {
        appId: cells[0] || '',
        gameName: cells[1] || '',
        publishStatus: cells[2] || '',
        planRelation: cells[4] || '',
        rawText: String(row.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    });
  }, { rowSelector: PAGE_ROW_SELECTOR, cellSelector: PAGE_CELL_SELECTOR });
}

async function gotoLastPageCandidate(page) {
  await page.waitForSelector(TABLE_SELECTOR, { timeout: 20000 });
  const nextSelector = 'li[aria-label="Next"]';
  while (true) {
    const nextDisabled = await page.evaluate((selector) => {
      const node = document.querySelector(selector);
      if (!node) return true;
      return node.getAttribute('aria-disabled') === 'true' || node.classList.contains('semi-dy-open-page-item-disabled');
    }, nextSelector);
    if (nextDisabled) {
      break;
    }
    await page.click(nextSelector);
    await page.waitForTimeout(600);
  }
  const rows = await extractCurrentPageRows(page);
  if (!rows.length) {
    throw new Error('最后一页未找到可审计的列表行');
  }
  return rows[0];
}

async function waitForCrawlFinished(popupPage) {
  throw new Error('请改用 waitForFreshDatasetAfterCrawl');
}

async function waitForFreshDatasetAfterCrawl(popupPage, crawlStartedAt) {
  await popupPage.waitForFunction(
    ({ startedAt }) => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['demogame_dataset', 'demogame_crawl_status'], (data) => {
          const dataset = data.demogame_dataset;
          const status = data.demogame_crawl_status;
          resolve(Boolean(
            dataset?.capturedAt >= startedAt
            && dataset?.totalItems > 0
            && status?.state === 'success'
            && /抓取完成/.test(status?.message || '')
          ));
        });
      });
    },
    { startedAt: crawlStartedAt },
    { timeout: 120000 }
  );
}

async function readDatasetFromPopup(popupPage) {
  return popupPage.evaluate(() => new Promise((resolve) => {
    chrome.storage.local.get(['demogame_dataset', 'demogame_crawl_status'], (data) => {
      resolve({
        dataset: data.demogame_dataset || null,
        crawlStatus: data.demogame_crawl_status || null,
      });
    });
  }));
}

async function searchAndAssert(popupPage, keyword, expectedGameName) {
  await popupPage.fill('#searchKeyword', keyword);
  await popupPage.click('#btnSearch');
  await popupPage.waitForTimeout(500);
  const summary = await popupPage.locator('#resultSummary').innerText();
  const resultText = await popupPage.locator('#resultList').innerText();
  if (!summary.includes('找到') || !resultText.includes(expectedGameName)) {
    throw new Error(`关键字「${keyword}」搜索结果不包含目标游戏「${expectedGameName}」`);
  }
  return { summary, resultText };
}

async function applyFiltersAndAssert(popupPage, item) {
  await popupPage.fill('#searchKeyword', item.gameName);
  if (item.publishStatus) {
    await popupPage.selectOption('#filterPublishStatus', item.publishStatus);
  }
  if (item.planRelation) {
    await popupPage.selectOption('#filterPlanRelation', item.planRelation);
  }
  await popupPage.click('#btnSearch');
  await popupPage.waitForTimeout(500);
  const detail = await popupPage.locator('#resultList').innerText();
  if (!detail.includes(item.gameName)) {
    throw new Error('筛选后的结果未包含目标游戏');
  }
}

async function executeFirstClickableAction(popupPage, targetPage) {
  const buttons = await popupPage.locator('#detailActions [data-action-key]').elementHandles();
  for (const button of buttons) {
    const disabled = await button.evaluate((node) => node.hasAttribute('disabled'));
    if (disabled) {
      continue;
    }
    const label = (await button.innerText()).trim();
    const beforeDialogs = await targetPage.locator(DIALOG_SELECTOR).count();
    await button.click();
    await targetPage.waitForTimeout(800);
    const afterDialogs = await targetPage.locator(DIALOG_SELECTOR).count();
    if (afterDialogs > beforeDialogs) {
      return { label, beforeDialogs, afterDialogs };
    }
    const pageText = await targetPage.locator('body').innerText();
    if (pageText.includes('变更日志') || pageText.includes('修改试玩')) {
      return { label, beforeDialogs, afterDialogs, detectedByText: true };
    }
  }
  throw new Error('未检测到可执行动作带来的页面变化');
}

async function main() {
  ensureDir(ARTIFACT_DIR);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-douyin-ext-'));
  const report = {
    startedAt: new Date().toISOString(),
    steps: [],
  };
  let testFailed = false;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: 150,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    logStep('启动 Chromium', '已加载本地扩展');
    const extensionId = await getExtensionId(context);
    report.extensionId = extensionId;
    const cookieState = await restorePersistedCookies(context);
    report.cookieRestore = cookieState;
    if (cookieState.restored) {
      logStep('恢复 Cookie', `已注入 ${cookieState.count} 个持久化 Cookie`);
    }

    const initialPage = await context.newPage();
    await initialPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    const { page: targetPage, neededManualLogin } = await resolveReadyTargetPage(context, initialPage);
    report.steps.push({ step: 'open-target-page', neededManualLogin });
    if (neededManualLogin) {
      const persisted = await persistCurrentCookies(context);
      report.cookiePersist = persisted;
      logStep('保存 Cookie', `首次人工登录完成后已保存 ${persisted.count} 个 Cookie`);
    }
    await screenshot(targetPage, '01-target-page-ready');

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await screenshot(popupPage, '02-popup-initial');

    logStep('清理旧数据', '通过 popup 清空旧抓取数据');
    await popupPage.click('#btnClearDataset');
    await popupPage.waitForTimeout(400);
    report.steps.push({ step: 'clear-dataset' });

    logStep('执行抓取', '通过 popup 触发全量抓取');
    const crawlStartedAt = Date.now();
    await popupPage.click('#btnStartCrawl');
    await waitForFreshDatasetAfterCrawl(popupPage, crawlStartedAt);
    const datasetState = await readDatasetFromPopup(popupPage);
    report.datasetSummary = {
      totalItems: datasetState?.dataset?.totalItems || 0,
      totalPages: datasetState?.dataset?.totalPages || 0,
      firstItems: (datasetState?.dataset?.items || []).slice(0, 10).map((item) => ({
        appId: item.appId,
        gameName: item.gameName,
        pageNo: item.pageNo,
      })),
    };
    await screenshot(popupPage, '03-crawl-finished');
    report.steps.push({ step: 'crawl-finished' });

    logStep('抽取非首页样本', '从最后一页提取一个样本，用于验证跨页搜索');
    await targetPage.bringToFront();
    const candidate = await gotoLastPageCandidate(targetPage);
    if (!candidate.appId || !candidate.gameName) {
      throw new Error('候选样本缺少 AppID 或试玩游戏名');
    }
    const candidateInDataset = (datasetState?.dataset?.items || []).some((item) =>
      item.appId === candidate.appId && item.gameName === candidate.gameName
    );
    if (!candidateInDataset) {
      throw new Error(`抓取数据未包含跨页样本：${candidate.gameName} (${candidate.appId})`);
    }
    report.candidate = candidate;
    await screenshot(targetPage, '04-target-last-page');

    await popupPage.bringToFront();
    logStep('关键字搜索', `按试玩游戏名搜索 ${candidate.gameName}`);
    const gameSearch = await searchAndAssert(popupPage, candidate.gameName, candidate.gameName);
    report.steps.push({ step: 'search-by-game-name', summary: gameSearch.summary });
    await screenshot(popupPage, '05-search-by-game-name');

    logStep('AppID 搜索', `按 AppID 搜索 ${candidate.appId}`);
    const appSearch = await searchAndAssert(popupPage, candidate.appId, candidate.gameName);
    report.steps.push({ step: 'search-by-appid', summary: appSearch.summary });
    await screenshot(popupPage, '06-search-by-appid');

    logStep('组合筛选', `发布状态=${candidate.publishStatus || '空'}, 广告计划关联=${candidate.planRelation || '空'}`);
    await applyFiltersAndAssert(popupPage, candidate);
    report.steps.push({
      step: 'filter-search',
      publishStatus: candidate.publishStatus,
      planRelation: candidate.planRelation,
    });
    await screenshot(popupPage, '07-filtered-search');

    logStep('执行操作', '从详情区触发第一个可执行动作');
    await targetPage.bringToFront();
    await screenshot(targetPage, '08-before-action');
    await popupPage.bringToFront();
    const actionResult = await executeFirstClickableAction(popupPage, targetPage);
    report.steps.push({ step: 'execute-action', actionResult });
    await targetPage.bringToFront();
    await screenshot(targetPage, '09-after-action');

    report.finishedAt = new Date().toISOString();
    report.success = true;
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'audit-report.json'),
      JSON.stringify(report, null, 2)
    );
    logStep('审计完成', `报告已写入 ${path.join(ARTIFACT_DIR, 'audit-report.json')}`);
  } catch (error) {
    testFailed = true;
    report.finishedAt = new Date().toISOString();
    report.success = false;
    report.error = error.message;
    try {
      const pages = context.pages();
      for (let index = 0; index < pages.length; index += 1) {
        await screenshot(pages[index], `error-page-${index + 1}`);
      }
    } catch (screenshotError) {
      report.screenshotError = screenshotError.message;
    }
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'audit-report.json'),
      JSON.stringify(report, null, 2)
    );
    await new Promise((resolve) => setTimeout(resolve, 4000));
    throw error;
  } finally {
    const keepOpen = process.env.PW_KEEP_OPEN === '1';
    if (!keepOpen) {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } else {
      logStep('保留浏览器', '设置了 PW_KEEP_OPEN=1，浏览器保持打开');
    }
  }
}

main().catch((error) => {
  console.error('[AUDIT ERROR]', error);
  process.exit(1);
});
