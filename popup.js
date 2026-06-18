// ============================================================
// 抖音开放平台 - 登录与试玩管理助手 (Popup)
// ============================================================

const btnSave = document.getElementById('btnSave');
const btnRestore = document.getElementById('btnRestore');
const btnClearCookies = document.getElementById('btnClearCookies');
const btnStartCrawl = document.getElementById('btnStartCrawl');
const btnRefresh = document.getElementById('btnRefresh');
const btnClearDataset = document.getElementById('btnClearDataset');
const btnSearch = document.getElementById('btnSearch');
const btnResetSearch = document.getElementById('btnResetSearch');

const loginStatus = document.getElementById('loginStatus');
const cookieCount = document.getElementById('cookieCount');
const savedInfo = document.getElementById('savedInfo');
const pageInfo = document.getElementById('pageInfo');
const crawlStatus = document.getElementById('crawlStatus');
const crawlSummary = document.getElementById('crawlSummary');
const capturedAt = document.getElementById('capturedAt');
const crawlHint = document.getElementById('crawlHint');
const searchKeyword = document.getElementById('searchKeyword');
const filterPublishStatus = document.getElementById('filterPublishStatus');
const filterPlanRelation = document.getElementById('filterPlanRelation');
const resultSummary = document.getElementById('resultSummary');
const resultList = document.getElementById('resultList');
const detailActions = document.getElementById('detailActions');
const detailBox = document.getElementById('detailBox');
const toast = document.getElementById('toast');

let toastTimer = null;
let selectedResultId = null;

function showToast(message, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show ${type}`.trim();
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 2500);
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '-';
  }
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function getItemDisplayAppId(item) {
  return String(
    item?.appId ||
    item?.fields?.['App ID'] ||
    item?.fields?.['AppID'] ||
    '-'
  ).trim() || '-';
}

function getItemDisplayGameName(item) {
  return String(
    item?.gameName ||
    item?.fields?.['试玩游戏名'] ||
    item?.fields?.['游戏试玩名称'] ||
    ''
  ).trim() || '未命名试玩游戏';
}

function isTargetPageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('developer.open-douyin.com')
      && parsed.pathname === '/demogame/list'
      && parsed.searchParams.get('tab') === 'demogameManage';
  } catch (error) {
    return false;
  }
}

function sendBackground(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function sendToActiveTab(action, payload = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return { success: false, error: '未找到当前活动标签页' };
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function setLoginState(state) {
  if (state?.isLoggedIn) {
    loginStatus.innerHTML = '<span class="status-dot on"></span>已登录';
    loginStatus.style.color = '#00b42a';
  } else {
    loginStatus.innerHTML = '<span class="status-dot off"></span>未登录';
    loginStatus.style.color = '#86909c';
  }
  cookieCount.textContent = state?.totalCookies ?? '-';
}

function setPageState(tab, pageState) {
  const isTarget = isTargetPageUrl(tab?.url || '');
  if (!tab) {
    pageInfo.textContent = '未找到活动标签页';
    btnStartCrawl.disabled = true;
    crawlHint.textContent = '请先打开目标页面。';
    return;
  }

  if (!isTarget) {
    pageInfo.textContent = '当前标签页不是试玩管理页';
    btnStartCrawl.disabled = true;
    crawlHint.textContent = '请切到 https://developer.open-douyin.com/demogame/list?tab=demogameManage 再抓取。';
    return;
  }

  if (pageState?.hasTable) {
    pageInfo.textContent = `已定位试玩管理页，第 ${pageState.pageNo || 1} 页`;
    crawlHint.textContent = '可从当前页开始自动翻页抓取。抓取过程中请勿手动翻页。';
  } else {
    pageInfo.textContent = '目标页面已打开，但表格未就绪';
    crawlHint.textContent = '请等待试玩管理表格加载完成后重试。';
  }

  btnStartCrawl.disabled = !pageState?.hasTable;
}

function setCrawlSummary(summary) {
  crawlSummary.textContent = `${summary?.totalPages || 0} / ${summary?.totalItems || 0}`;
  capturedAt.textContent = formatTime(summary?.capturedAt);

  const state = summary?.crawlStatus?.state || 'idle';
  const message = summary?.crawlStatus?.message || '等待抓取';
  const error = summary?.crawlStatus?.error;
  crawlStatus.textContent = error ? `${message}：${error}` : message;
}

function renderFilterSelect(selectNode, values, defaultLabel, currentValue = '') {
  const safeValues = Array.isArray(values) ? values : [];
  selectNode.innerHTML = [
    `<option value="">${defaultLabel}</option>`,
    ...safeValues.map((value) => `<option value="${value}">${value}</option>`),
  ].join('');
  selectNode.value = safeValues.includes(currentValue) ? currentValue : '';
}

function renderEmptyResults(message) {
  resultSummary.textContent = message;
  resultList.innerHTML = `<div class="empty">${message}</div>`;
  detailActions.innerHTML = '<button class="btn btn-secondary" disabled>先选择一个搜索结果</button>';
  detailBox.textContent = '点击上方结果项后，在这里查看字段详情和原始文本。';
  selectedResultId = null;
}

function renderDetailActions(item) {
  const operations = Array.isArray(item?.operations) ? item.operations : [];
  if (!operations.length) {
    detailActions.innerHTML = '<button class="btn btn-secondary" disabled>未抓取到操作信息</button>';
    return;
  }

  detailActions.innerHTML = operations.map((operation) => `
    <button
      class="btn ${operation.clickable ? 'btn-primary' : 'btn-secondary'}"
      data-action-key="${operation.key}"
      ${operation.clickable ? '' : 'disabled'}
      title="${operation.href || '该动作无独立超链接，执行时复用页面原点击事件'}"
    >
      ${operation.label}${operation.clickable ? '' : '（不可执行）'}
    </button>
  `).join('');

  detailActions.querySelectorAll('[data-action-key]').forEach((button) => {
    button.addEventListener('click', async () => {
      const actionKey = button.dataset.actionKey;
      await handleExecuteAction(item, actionKey, button);
    });
  });
}

function renderDetail(item) {
  if (!item) {
    detailActions.innerHTML = '<button class="btn btn-secondary" disabled>未找到动作信息</button>';
    detailBox.textContent = '未找到记录详情。';
    return;
  }

  const fieldsText = Object.entries(item.fields || {})
    .map(([key, value]) => `${key}: ${value || '-'}`)
    .join('\n');

  detailBox.textContent = [
    `AppID: ${getItemDisplayAppId(item)}`,
    `试玩游戏名: ${getItemDisplayGameName(item)}`,
    `所在页码: ${item.pageNo || '-'}`,
    `页内序号: ${item.itemIndex ?? '-'}`,
    '',
    '操作信息：',
    ...(Array.isArray(item.operations) && item.operations.length
      ? item.operations.map((operation) => {
        const linkPart = operation.href ? `href=${operation.href}` : 'href=无（DOM 事件）';
        const clickablePart = operation.clickable ? '可执行' : '不可执行';
        return `${operation.label}: ${clickablePart}, ${linkPart}`;
      })
      : ['-']),
    '',
    '字段详情：',
    fieldsText || '-',
    '',
    '原始文本：',
    item.rawText || '-',
  ].join('\n');

  renderDetailActions(item);
}

function renderResults(items) {
  if (!items.length) {
    renderEmptyResults('未找到匹配结果');
    return;
  }

  if (!selectedResultId) {
    selectedResultId = items[0].id;
  }

  resultSummary.textContent = `找到 ${items.length} 条结果`;
  resultList.innerHTML = items.map((item) => `
    <div class="result-item ${item.id === selectedResultId ? 'active' : ''}" data-id="${item.id}">
      <div class="result-title">${getItemDisplayGameName(item)}</div>
      <div class="result-meta">
        AppID: ${getItemDisplayAppId(item)}<br>
        所在页码: 第 ${item.pageNo || '-'} 页<br>
        发布状态: ${item.fields?.['发布状态'] || '-'}
      </div>
    </div>
  `).join('');

  resultList.querySelectorAll('.result-item').forEach((node) => {
    node.addEventListener('click', async () => {
      selectedResultId = node.dataset.id;
      const detail = await sendBackground('getDemogameItemDetail', { id: selectedResultId });
      if (detail?.success) {
        renderResults(items);
        renderDetail(detail.item);
      } else {
        showToast(detail?.message || detail?.error || '加载详情失败', 'error');
      }
    });
  });

  renderDetail(items.find((item) => item.id === selectedResultId) || items[0]);
}

async function handleExecuteAction(item, actionKey, button) {
  const tab = await getActiveTab();
  if (!isTargetPageUrl(tab?.url || '')) {
    showToast('请先切到试玩管理页面后再执行操作', 'error');
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = '执行中...';

  const result = await sendToActiveTab('executeDemogameAction', { item, actionKey });

  button.textContent = originalText;
  button.disabled = false;

  if (result?.success) {
    showToast(result.message, 'success');
  } else {
    showToast(result?.error || result?.message || '执行失败', 'error');
  }
}

async function refreshOverview() {
  btnRefresh.disabled = true;
  btnRefresh.textContent = '刷新中...';

  const activeTab = await getActiveTab();
  const [loginState, savedData, summary, pageState] = await Promise.all([
    sendBackground('checkLoginState'),
    sendBackground('getSavedInfo'),
    sendBackground('getDemogameDatasetSummary'),
    isTargetPageUrl(activeTab?.url || '') ? sendToActiveTab('getPageInfo') : Promise.resolve(null),
  ]);

  setLoginState(loginState);
  savedInfo.textContent = savedData?.saved
    ? `${formatTime(savedData.saved.savedAt)}（${savedData.saved.count} 个 Cookie）`
    : '尚未保存';
  setPageState(activeTab, pageState);
  setCrawlSummary(summary);
  renderFilterSelect(
    filterPublishStatus,
    summary?.filterOptions?.publishStatuses,
    '全部发布状态',
    filterPublishStatus.value
  );
  renderFilterSelect(
    filterPlanRelation,
    summary?.filterOptions?.planRelations,
    '全部广告计划关联状态',
    filterPlanRelation.value
  );

  if (!summary?.hasData) {
    renderEmptyResults('暂无抓取数据，请先执行抓取。');
  }

  btnRefresh.disabled = false;
  btnRefresh.textContent = '刷新状态';
}

async function handleSaveCookies() {
  btnSave.disabled = true;
  const result = await sendBackground('saveCookies');
  btnSave.disabled = false;
  showToast(result?.message || result?.error || '保存失败', result?.success ? 'success' : 'error');
  await refreshOverview();
}

async function handleRestoreCookies() {
  btnRestore.disabled = true;
  const result = await sendBackground('restoreCookies');
  btnRestore.disabled = false;
  showToast(result?.message || result?.error || '恢复失败', result?.success ? 'success' : 'error');
  await refreshOverview();
}

async function handleClearCookies() {
  if (!confirm('确定要清除当前所有 Cookie 吗？这会导致退出登录。')) {
    return;
  }
  btnClearCookies.disabled = true;
  const result = await sendBackground('clearCookies');
  btnClearCookies.disabled = false;
  showToast(result?.message || result?.error || '清除失败', result?.success ? 'success' : 'error');
  await refreshOverview();
}

async function handleStartCrawl() {
  const tab = await getActiveTab();
  if (!isTargetPageUrl(tab?.url || '')) {
    showToast('请先切到试玩管理页面', 'error');
    return;
  }

  btnStartCrawl.disabled = true;
  btnStartCrawl.textContent = '抓取中...';

  const result = await sendToActiveTab('startDemogameCrawl');
  btnStartCrawl.textContent = '开始抓取';

  if (result?.success) {
    showToast(result.message, 'success');
  } else {
    showToast(result?.error || result?.message || '抓取失败', 'error');
  }

  await refreshOverview();
}

async function handleClearDataset() {
  const result = await sendBackground('clearDemogameDataset');
  showToast(result?.message || result?.error || '清空失败', result?.success ? 'success' : 'error');
  renderEmptyResults('暂无抓取数据，请先执行抓取。');
  await refreshOverview();
}

async function handleSearch() {
  const queryText = searchKeyword.value.trim();
  const publishStatus = filterPublishStatus.value.trim();
  const planRelation = filterPlanRelation.value.trim();
  const result = await sendBackground('searchDemogameItems', {
    queryText,
    publishStatus,
    planRelation,
  });

  if (!result?.success) {
    renderEmptyResults(result?.message || result?.error || '搜索失败');
    return;
  }

  selectedResultId = null;
  renderResults(result.items || []);
}

function handleResetSearch() {
  searchKeyword.value = '';
  filterPublishStatus.value = '';
  filterPlanRelation.value = '';
  renderEmptyResults('搜索条件已清空。请重新输入条件。');
}

btnSave.addEventListener('click', handleSaveCookies);
btnRestore.addEventListener('click', handleRestoreCookies);
btnClearCookies.addEventListener('click', handleClearCookies);
btnStartCrawl.addEventListener('click', handleStartCrawl);
btnRefresh.addEventListener('click', refreshOverview);
btnClearDataset.addEventListener('click', handleClearDataset);
btnSearch.addEventListener('click', handleSearch);
btnResetSearch.addEventListener('click', handleResetSearch);
searchKeyword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleSearch();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  refreshOverview();
});
