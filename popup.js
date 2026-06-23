// ============================================================
// 抖音开放平台 - 登录与试玩管理助手 (Popup)
// ============================================================

const btnToggleLogin = document.getElementById('btnToggleLogin');
const btnSave = document.getElementById('btnSave');
const btnRestore = document.getElementById('btnRestore');
const btnClearCookies = document.getElementById('btnClearCookies');
const btnStartCrawl = document.getElementById('btnStartCrawl');
const btnRefresh = document.getElementById('btnRefresh');
const btnClearDataset = document.getElementById('btnClearDataset');
const btnSearch = document.getElementById('btnSearch');
const btnResetSearch = document.getElementById('btnResetSearch');
const btnClosePanel = document.getElementById('btnClosePanel');

const loginStatus = document.getElementById('loginStatus');
const cookieCount = document.getElementById('cookieCount');
const savedInfo = document.getElementById('savedInfo');
const pageInfo = document.getElementById('pageInfo');
const crawlStatus = document.getElementById('crawlStatus');
const crawlSummary = document.getElementById('crawlSummary');
const capturedAt = document.getElementById('capturedAt');
const crawlHint = document.getElementById('crawlHint');
const searchKeyword = document.getElementById('searchKeyword');
const filterToolbar = document.getElementById('filterToolbar');
const filterPublishStatus = document.getElementById('filterPublishStatus');
const filterPlanRelation = document.getElementById('filterPlanRelation');
const resultSummary = document.getElementById('resultSummary');
const resultList = document.getElementById('resultList');
const detailTitle = document.getElementById('detailTitle');
const detailSubtitle = document.getElementById('detailSubtitle');
const detailFields = document.getElementById('detailFields');
const toast = document.getElementById('toast');

const LOGIN_VISIBILITY_KEY = 'douyin-helper-login-visible';

let toastTimer = null;
let selectedResultId = null;
let overviewRefreshTimer = null;
let currentResults = [];
let searchToolbarVisible = false;

const pageParams = new URLSearchParams(window.location.search);
const isEmbeddedMode = pageParams.get('embedded') === '1';

if (isEmbeddedMode) {
  document.body.classList.add('embedded');
  btnClosePanel?.classList.remove('hidden');
}

function showToast(message, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show ${type}`.trim();
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 2500);
}

function notifyParentToClose() {
  if (!isEmbeddedMode) {
    return;
  }
  window.parent?.postMessage({
    source: 'douyin-open-helper',
    action: 'close-embedded-panel',
  }, '*');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function getItemPublishStatus(item) {
  return String(item?.fields?.['发布状态'] || '').trim();
}

function getItemPlanRelation(item) {
  return String(item?.fields?.['是否关联广告计划'] || '').trim();
}

function getStatusTagClass(value) {
  if (value === '已上线' || value === '已发布') {
    return 'success';
  }
  if (value === '未发布' || value === '新创建') {
    return 'warning';
  }
  return '';
}

function getSortedOperations(item) {
  const operations = Array.isArray(item?.operations) ? item.operations : [];
  const rank = {
    edit: 0,
    delete: 1,
    changeLog: 2,
  };
  return [...operations].sort((left, right) => (rank[left.key] ?? 99) - (rank[right.key] ?? 99));
}

function setLoginPanelVisible(visible) {
  const enabled = Boolean(visible);
  document.body.classList.toggle('login-collapsed', !enabled);
  btnToggleLogin?.classList.toggle('active', enabled);
  btnToggleLogin.textContent = enabled ? '登录开' : '登录关';
  localStorage.setItem(LOGIN_VISIBILITY_KEY, enabled ? '1' : '0');
}

function initializeLoginPanelVisibility() {
  const stored = localStorage.getItem(LOGIN_VISIBILITY_KEY);
  setLoginPanelVisible(stored === '1');
}

function setSearchToolbarVisible(visible) {
  searchToolbarVisible = Boolean(visible);
  filterToolbar.classList.toggle('visible', searchToolbarVisible);
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

async function getTabPageInfo(tabId) {
  if (!tabId) {
    return null;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

async function findTargetTab() {
  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  const allTabs = await chrome.tabs.query({});
  const candidateMap = new Map();

  [...currentWindowTabs, ...allTabs]
    .filter((tab) => isTargetPageUrl(tab.url || ''))
    .forEach((tab) => {
      candidateMap.set(tab.id, tab);
    });

  const candidates = Array.from(candidateMap.values());
  if (!candidates.length) {
    return null;
  }

  for (const tab of candidates) {
    const pageInfo = await getTabPageInfo(tab.id);
    if (pageInfo?.isTargetPage && pageInfo?.hasTable) {
      return { ...tab, pageInfo };
    }
  }

  const activeMatchedTab = currentWindowTabs.find((tab) => tab.active && isTargetPageUrl(tab.url || ''));
  if (activeMatchedTab?.id) {
    return { ...activeMatchedTab, pageInfo: await getTabPageInfo(activeMatchedTab.id) };
  }

  const currentWindowMatchedTab = currentWindowTabs.find((tab) => isTargetPageUrl(tab.url || ''));
  if (currentWindowMatchedTab?.id) {
    return { ...currentWindowMatchedTab, pageInfo: await getTabPageInfo(currentWindowMatchedTab.id) };
  }

  const fallbackTab = candidates[0];
  return { ...fallbackTab, pageInfo: await getTabPageInfo(fallbackTab.id) };
}

async function sendToTargetTab(action, payload = {}) {
  const tab = await findTargetTab();
  if (!tab?.id) {
    return { success: false, error: '未找到试玩管理页面标签页' };
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
    crawlHint.textContent = '请切到试玩管理页面后再抓取。';
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
    ...safeValues.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join('');
  selectNode.value = safeValues.includes(currentValue) ? currentValue : '';
}

function renderEmptyDetail(message) {
  detailTitle.textContent = '结果详情';
  detailSubtitle.textContent = '选择一条记录后查看字段详情';
  detailFields.innerHTML = `<div class="detail-placeholder">${escapeHtml(message)}</div>`;
}

function renderDetail(item) {
  if (!item) {
    renderEmptyDetail('选择搜索结果后，这里会显示结构化字段，不再展示原始文本。');
    return;
  }

  detailTitle.textContent = getItemDisplayGameName(item);
  detailSubtitle.textContent = getItemDisplayAppId(item);

  const fields = {
    AppID: getItemDisplayAppId(item),
    试玩游戏名: getItemDisplayGameName(item),
    发布状态: getItemPublishStatus(item) || '-',
    是否关联广告计划: getItemPlanRelation(item) || '-',
    所在页码: item.pageNo ? `第 ${item.pageNo} 页` : '-',
    页内序号: Number.isFinite(item.itemIndex) ? String(item.itemIndex) : '-',
    MaterialID: item.fields?.MaterialID || '-',
    描述: item.fields?.描述 || '-',
  };

  detailFields.innerHTML = Object.entries(fields).map(([label, value]) => `
    <div class="field-item">
      <div class="field-label">${escapeHtml(label)}</div>
      <div class="field-value">${escapeHtml(value || '-')}</div>
    </div>
  `).join('');
}

function renderEmptyResults(message) {
  currentResults = [];
  selectedResultId = null;
  resultSummary.textContent = message;
  resultList.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  renderEmptyDetail('选择搜索结果后，这里会显示结构化字段，不再展示原始文本。');
}

function renderResults(items) {
  currentResults = Array.isArray(items) ? items : [];
  if (!currentResults.length) {
    renderEmptyResults('未找到匹配结果');
    return;
  }

  if (!selectedResultId || !currentResults.some((item) => item.id === selectedResultId)) {
    selectedResultId = currentResults[0].id;
  }

  resultSummary.textContent = `找到 ${currentResults.length} 条结果`;
  resultList.innerHTML = currentResults.map((item) => `
    <div class="result-item ${item.id === selectedResultId ? 'active' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="result-main">
        <div class="result-title">${escapeHtml(getItemDisplayGameName(item))}</div>
        <div class="result-appid">${escapeHtml(getItemDisplayAppId(item))}</div>
        <div class="result-meta">
          <span class="tag ${getStatusTagClass(getItemPublishStatus(item))}">${escapeHtml(getItemPublishStatus(item) || '未知状态')}</span>
          <span class="tag">${escapeHtml(getItemPlanRelation(item) || '未知关联')}</span>
          <span class="tag">第 ${escapeHtml(item.pageNo || '-')} 页</span>
        </div>
      </div>
      <div class="result-actions-inline">
        ${getSortedOperations(item).map((operation) => `
          <button
            class="action-btn ${operation.key === 'edit' ? 'primary' : ''}"
            data-result-id="${escapeHtml(item.id)}"
            data-action-key="${escapeHtml(operation.key)}"
            ${operation.clickable ? '' : 'disabled'}
          >${escapeHtml(operation.key === 'changeLog' ? '显示日志' : operation.label)}</button>
        `).join('')}
      </div>
    </div>
  `).join('');

  resultList.querySelectorAll('.result-item').forEach((node) => {
    node.addEventListener('click', () => {
      const id = node.dataset.id;
      selectedResultId = id;
      renderResults(currentResults);
      renderDetail(currentResults.find((item) => item.id === id) || null);
    });
  });

  resultList.querySelectorAll('[data-action-key]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const actionKey = button.dataset.actionKey;
      const itemId = button.dataset.resultId;
      const item = currentResults.find((candidate) => candidate.id === itemId);
      if (!item) {
        showToast('未找到要执行的记录', 'error');
        return;
      }
      selectedResultId = item.id;
      renderResults(currentResults);
      renderDetail(item);
      await handleExecuteAction(item, actionKey, button);
    });
  });

  renderDetail(currentResults.find((item) => item.id === selectedResultId) || currentResults[0]);
}

async function handleExecuteAction(item, actionKey, button) {
  const tab = await findTargetTab();
  if (!isTargetPageUrl(tab?.url || '')) {
    showToast('请先切到试玩管理页面后再执行操作', 'error');
    return;
  }

  if (isEmbeddedMode) {
    notifyParentToClose();
    await sleep(80);
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = '执行中';

  const result = await sendToTargetTab('executeDemogameAction', { item, actionKey });

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
  const targetTab = await findTargetTab();
  const [loginState, savedData, summary, pageState] = await Promise.all([
    sendBackground('checkLoginState'),
    sendBackground('getSavedInfo'),
    sendBackground('getDemogameDatasetSummary'),
    Promise.resolve(targetTab?.pageInfo || null),
  ]);

  setLoginState(loginState);
  savedInfo.textContent = savedData?.saved
    ? `${formatTime(savedData.saved.savedAt)}（${savedData.saved.count} 个 Cookie）`
    : '尚未保存';
  setPageState(targetTab || activeTab, pageState);
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

  if (!summary?.hasData && !currentResults.length) {
    renderEmptyResults('暂无抓取数据，请先执行抓取。');
  }

  btnRefresh.disabled = false;
  btnRefresh.textContent = '刷新状态';
}

function scheduleOverviewRefresh() {
  clearTimeout(overviewRefreshTimer);
  overviewRefreshTimer = setTimeout(() => {
    refreshOverview();
  }, 150);
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
  const tab = await findTargetTab();
  if (!isTargetPageUrl(tab?.url || '')) {
    showToast('请先切到试玩管理页面', 'error');
    return;
  }

  btnStartCrawl.disabled = true;
  btnStartCrawl.textContent = '抓取中...';

  const result = await sendToTargetTab('startDemogameCrawl');
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
  currentResults = [];
  setSearchToolbarVisible(false);
  renderEmptyResults('暂无抓取数据，请先执行抓取。');
  await refreshOverview();
}

async function handleSearch() {
  const queryText = searchKeyword.value.trim();
  const publishStatus = filterPublishStatus.value.trim();
  const planRelation = filterPlanRelation.value.trim();
  setSearchToolbarVisible(true);

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
  currentResults = [];
  setSearchToolbarVisible(false);
  renderEmptyResults('搜索条件已清空。可直接点击搜索查看全部结果，或输入关键词后再搜索。');
}

btnToggleLogin?.addEventListener('click', () => {
  setLoginPanelVisible(document.body.classList.contains('login-collapsed'));
});
btnSave.addEventListener('click', handleSaveCookies);
btnRestore.addEventListener('click', handleRestoreCookies);
btnClearCookies.addEventListener('click', handleClearCookies);
btnStartCrawl.addEventListener('click', handleStartCrawl);
btnRefresh.addEventListener('click', refreshOverview);
btnClearDataset.addEventListener('click', handleClearDataset);
btnSearch.addEventListener('click', handleSearch);
btnResetSearch.addEventListener('click', handleResetSearch);
btnClosePanel?.addEventListener('click', notifyParentToClose);
filterPublishStatus.addEventListener('change', () => {
  if (searchToolbarVisible) {
    handleSearch();
  }
});
filterPlanRelation.addEventListener('change', () => {
  if (searchToolbarVisible) {
    handleSearch();
  }
});
searchKeyword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleSearch();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initializeLoginPanelVisibility();
  refreshOverview();
  renderEmptyDetail('选择搜索结果后，这里会显示结构化字段，不再展示原始文本。');
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (
    changes.demogame_dataset ||
    changes.demogame_crawl_status ||
    changes.saved_cookies
  ) {
    scheduleOverviewRefresh();
  }
});
