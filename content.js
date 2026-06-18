// ============================================================
// 抖音开放平台 - 登录与试玩管理助手 (Content Script)
// ============================================================

(function () {
  'use strict';

  const TARGET_PATH = '/demogame/list';
  const TARGET_TAB = 'demogameManage';
  const TABLE_SELECTOR = 'table.semi-dy-open-table[role="treegrid"]';
  const HEADER_SELECTOR = 'thead [role="columnheader"], thead th';
  const ROW_SELECTOR = 'tbody tr.semi-dy-open-table-row';
  const CELL_SELECTOR = 'td.semi-dy-open-table-row-cell';
  const ACTIVE_PAGE_SELECTOR = '.semi-dy-open-page-item.semi-dy-open-page-item-active';
  const PREVIOUS_BUTTON_SELECTORS = [
    'li[aria-label="Previous"]',
    'li.semi-dy-open-page-prev',
  ];
  const NEXT_BUTTON_SELECTORS = [
    'li[aria-label="Next"]',
    'li.semi-dy-open-page-next',
  ];
  const ACTION_LABELS = {
    edit: '修改',
    changeLog: '变更日志',
    delete: '删除',
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function buildRowId(record) {
    return [record.appId || 'unknown-app', record.pageNo || 0, record.itemIndex || 0].join('-');
  }

  function isTargetPage() {
    const url = new URL(window.location.href);
    return url.pathname === TARGET_PATH && url.searchParams.get('tab') === TARGET_TAB;
  }

  function getTargetTable() {
    return document.querySelector(TABLE_SELECTOR);
  }

  function getHeaders(table) {
    return Array.from(table.querySelectorAll(HEADER_SELECTOR))
      .map((cell) => normalizeText(cell.textContent))
      .filter(Boolean);
  }

  function getCurrentPageNumber() {
    const activeItem = document.querySelector(ACTIVE_PAGE_SELECTOR);
    const pageNumber = Number.parseInt(normalizeText(activeItem?.textContent || ''), 10);
    return Number.isFinite(pageNumber) ? pageNumber : 1;
  }

  function getNextButton() {
    for (const selector of NEXT_BUTTON_SELECTORS) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }
    return null;
  }

  function getPreviousButton() {
    for (const selector of PREVIOUS_BUTTON_SELECTORS) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }
    return null;
  }

  function isNextButtonDisabled(button) {
    if (!button) {
      return true;
    }
    const ariaDisabled = button.getAttribute('aria-disabled');
    return ariaDisabled === 'true' || button.classList.contains('semi-dy-open-page-item-disabled');
  }

  function getTableSignature(table) {
    const firstRow = table?.querySelector(ROW_SELECTOR);
    const firstRowText = normalizeText(firstRow?.innerText || '');
    return `${getCurrentPageNumber()}::${firstRowText}`;
  }

  function isElementDisabled(element) {
    if (!element) {
      return true;
    }

    const ariaDisabled = element.getAttribute('aria-disabled');
    const style = window.getComputedStyle(element);
    return (
      ariaDisabled === 'true' ||
      element.classList.contains('semi-dy-open-typography-disabled') ||
      style.pointerEvents === 'none' ||
      style.cursor === 'not-allowed'
    );
  }

  function findActionCandidate(actionCell, actionKey) {
    const label = ACTION_LABELS[actionKey];
    const candidates = Array.from(actionCell.querySelectorAll('a, button, [tabindex], span'))
      .filter((element) => normalizeText(element.textContent) === label);

    const score = (element) => {
      let current = 0;
      if (element.tagName === 'A') current += 100;
      if (element.tagName === 'BUTTON') current += 95;
      if (element.hasAttribute('tabindex')) current += 85;
      if (!isElementDisabled(element)) current += 20;
      if (window.getComputedStyle(element).cursor === 'pointer') current += 10;
      return current;
    };

    return candidates.sort((left, right) => score(right) - score(left))[0] || null;
  }

  function extractOperations(actionCell) {
    return Object.entries(ACTION_LABELS).map(([key, label]) => {
      const element = findActionCandidate(actionCell, key);
      const hrefAttr = element?.getAttribute('href') || '';
      const absoluteHref = hrefAttr
        ? new URL(hrefAttr, window.location.href).toString()
        : null;

      return {
        key,
        label,
        href: absoluteHref,
        hrefAttr: hrefAttr || null,
        executionMode: 'dom-click',
        clickable: Boolean(element) && !isElementDisabled(element),
      };
    });
  }

  function parseRow(row, headers, pageNo, itemIndex) {
    const cells = Array.from(row.querySelectorAll(CELL_SELECTOR));
    const fields = {};

    headers.forEach((header, index) => {
      fields[header] = normalizeText(cells[index]?.innerText || '');
    });

    const appId = fields['App ID'] || '';
    const gameName = fields['试玩游戏名'] || '';
    const actionCell = cells[cells.length - 1];

    return {
      id: buildRowId({ appId, pageNo, itemIndex }),
      appId,
      gameName,
      pageNo,
      itemIndex,
      rawText: normalizeText(row.innerText),
      fields,
      operations: actionCell ? extractOperations(actionCell) : [],
      capturedAt: Date.now(),
    };
  }

  function extractCurrentPageItems() {
    const table = getTargetTable();
    if (!table) {
      throw new Error('未找到试玩管理表格');
    }

    const headers = getHeaders(table);
    if (!headers.length) {
      throw new Error('未找到表头，无法结构化解析');
    }

    const pageNo = getCurrentPageNumber();
    const rows = Array.from(table.querySelectorAll(ROW_SELECTOR));

    return {
      pageNo,
      headers,
      items: rows.map((row, index) => parseRow(row, headers, pageNo, index)),
      signature: getTableSignature(table),
    };
  }

  async function waitForPageChange(previousSignature, expectedPageNo) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(400);
      const table = getTargetTable();
      if (!table) {
        continue;
      }

      const currentSignature = getTableSignature(table);
      const currentPageNo = getCurrentPageNumber();
      if (currentSignature && currentSignature !== previousSignature) {
        return true;
      }
      if (expectedPageNo && currentPageNo === expectedPageNo) {
        return true;
      }
    }

    return false;
  }

  async function updateCrawlStatus(payload) {
    return chrome.runtime.sendMessage({
      action: 'setCrawlStatus',
      payload,
    });
  }

  async function saveDataset(dataset) {
    return chrome.runtime.sendMessage({
      action: 'saveDemogameDataset',
      payload: dataset,
    });
  }

  async function crawlDemogameList() {
    if (!isTargetPage()) {
      throw new Error('当前页面不是试玩管理页');
    }

    const table = getTargetTable();
    if (!table) {
      throw new Error('当前页面未渲染出试玩管理表格');
    }

    const items = [];
    const seenIds = new Set();
    let totalPages = 0;

    await updateCrawlStatus({
      state: 'running',
      message: '开始抓取试玩管理列表',
      sourceUrl: window.location.href,
      pageNo: getCurrentPageNumber(),
    });

    while (true) {
      const pageData = extractCurrentPageItems();
      totalPages = Math.max(totalPages, pageData.pageNo);

      pageData.items.forEach((item) => {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          items.push(item);
        }
      });

      await updateCrawlStatus({
        state: 'running',
        message: `已抓取第 ${pageData.pageNo} 页，累计 ${items.length} 条`,
        sourceUrl: window.location.href,
        pageNo: pageData.pageNo,
        totalPages: pageData.pageNo,
        totalItems: items.length,
      });

      const nextButton = getNextButton();
      if (isNextButtonDisabled(nextButton)) {
        break;
      }

      const previousSignature = pageData.signature;
      const currentPageNo = pageData.pageNo;
      nextButton.click();
      const changed = await waitForPageChange(previousSignature, currentPageNo + 1);

      if (!changed) {
        throw new Error(`翻到第 ${currentPageNo + 1} 页时未检测到列表更新`);
      }
    }

    const dataset = {
      source: { url: window.location.href },
      capturedAt: Date.now(),
      totalPages,
      items,
    };

    await saveDataset(dataset);

    return {
      success: true,
      totalPages,
      totalItems: items.length,
      items,
      message: `抓取完成，共 ${totalPages} 页，${items.length} 条`,
    };
  }

  function getPageButton(pageNo) {
    return document.querySelector(`li[aria-label="Page ${pageNo}"]`);
  }

  function findRowByItem(item) {
    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR));
    return rows.find((row) => {
      const cells = Array.from(row.querySelectorAll(CELL_SELECTOR));
      const rowAppId = normalizeText(cells[0]?.innerText || '');
      const rowGameName = normalizeText(cells[1]?.innerText || '');
      return rowAppId === normalizeText(item.appId) && rowGameName === normalizeText(item.gameName);
    }) || null;
  }

  async function gotoPage(targetPageNo) {
    const target = Number(targetPageNo);
    if (!Number.isFinite(target) || target < 1) {
      throw new Error('目标页码无效');
    }

    let attempts = 0;
    while (getCurrentPageNumber() !== target && attempts < 30) {
      attempts += 1;
      const currentPageNo = getCurrentPageNumber();
      const beforeSignature = getTableSignature(getTargetTable());
      const directButton = getPageButton(target);

      if (directButton) {
        directButton.click();
      } else if (target > currentPageNo) {
        const nextButton = getNextButton();
        if (isNextButtonDisabled(nextButton)) {
          throw new Error(`无法翻到第 ${target} 页`);
        }
        nextButton.click();
      } else {
        const previousButton = getPreviousButton();
        if (isNextButtonDisabled(previousButton)) {
          throw new Error(`无法翻到第 ${target} 页`);
        }
        previousButton.click();
      }

      const changed = await waitForPageChange(beforeSignature, target);
      if (!changed) {
        throw new Error(`跳转到第 ${target} 页失败`);
      }
    }

    if (getCurrentPageNumber() !== target) {
      throw new Error(`未能定位到第 ${target} 页`);
    }
  }

  async function executeDemogameAction(payload = {}) {
    if (!isTargetPage()) {
      throw new Error('当前页面不是试玩管理页');
    }

    const item = payload.item;
    const actionKey = payload.actionKey;
    if (!item?.appId || !item?.gameName) {
      throw new Error('缺少目标记录信息');
    }
    if (!ACTION_LABELS[actionKey]) {
      throw new Error('不支持的动作类型');
    }

    await gotoPage(item.pageNo);

    const row = findRowByItem(item);
    if (!row) {
      throw new Error(`第 ${item.pageNo} 页未找到目标记录`);
    }

    const actionCell = row.querySelector('td:last-child');
    const actionElement = actionCell ? findActionCandidate(actionCell, actionKey) : null;
    if (!actionElement) {
      throw new Error(`未找到「${ACTION_LABELS[actionKey]}」动作节点`);
    }
    if (isElementDisabled(actionElement)) {
      throw new Error(`「${ACTION_LABELS[actionKey]}」当前不可执行`);
    }

    actionElement.click();
    await sleep(300);

    return {
      success: true,
      pageNo: getCurrentPageNumber(),
      actionKey,
      actionLabel: ACTION_LABELS[actionKey],
      message: `已定位到第 ${item.pageNo} 页并触发「${ACTION_LABELS[actionKey]}」`,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message?.action) {
          case 'getPageInfo':
            sendResponse({
              url: window.location.href,
              title: document.title,
              isTargetPage: isTargetPage(),
              hasTable: Boolean(getTargetTable()),
              pageNo: getCurrentPageNumber(),
            });
            break;
          case 'startDemogameCrawl':
            sendResponse(await crawlDemogameList());
            break;
          case 'executeDemogameAction':
            sendResponse(await executeDemogameAction(message.payload));
            break;
          default:
            sendResponse({ success: false, error: '未知操作' });
        }
      } catch (error) {
        console.error('[Assistant] 页面抓取失败:', error);
        await updateCrawlStatus({
          state: 'error',
          message: '抓取失败',
          sourceUrl: window.location.href,
          error: error?.message || '未知错误',
        });
        sendResponse({
          success: false,
          error: error?.message || '抓取失败',
        });
      }
    })();

    return true;
  });

  const observer = new MutationObserver(() => {
    const userElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="profile"]');
    if (userElements.length > 0) {
      console.debug('[Assistant] 检测到用户相关元素');
    }
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  setInterval(() => {
    chrome.runtime.sendMessage({ action: 'checkLoginState' }, () => {});
  }, 30000);
})();
