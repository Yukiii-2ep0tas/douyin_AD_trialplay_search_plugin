// ============================================================
// 抖音开放平台 - 登录与试玩管理助手 (Background Service Worker)
// ============================================================

const TARGET_DOMAIN = '.open-douyin.com';
const TARGET_URL = 'https://developer.open-douyin.com/demogame/list?tab=demogameManage';

const COOKIE_STORAGE_KEY = 'saved_cookies';
const LOGIN_STATE_KEY = 'login_state';
const DEMOGAME_DATASET_KEY = 'demogame_dataset';
const DEMOGAME_SEARCH_INDEX_KEY = 'demogame_search_index';
const DEMOGAME_CRAWL_STATUS_KEY = 'demogame_crawl_status';

const KEY_COOKIE_NAMES = [
  'sessionid',
  'sessionid_ss',
  'csrf_session_id',
  'passport_csrf_token',
  'passport_csrf_token_default',
  'sso_uid_tt',
  'sso_uid_tt_ss',
  'sid_guard',
  'uid_tt',
  'uid_tt_ss',
  'sid_tt',
  'sid_tt_ss',
  'store_session_id',
  'odin_tt',
  'n_mh',
  's_v_web_id',
  'ttwid',
  'MONITOR_WEB_ID',
  '__tea_sdk__',
  'tea_sdk_trace_id',
  'is_anonymous',
  'is_staff',
  'X-Janus-Session',
];

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeSearchValue(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeCompactValue(value) {
  return normalizeSearchValue(value).replace(/\s+/g, '');
}

function getItemAppId(item) {
  return normalizeString(
    item?.appId ||
    item?.fields?.['App ID'] ||
    item?.fields?.['AppID']
  );
}

function getItemGameName(item) {
  return normalizeString(
    item?.gameName ||
    item?.fields?.['试玩游戏名'] ||
    item?.fields?.['游戏试玩名称']
  );
}

function getItemPublishStatus(item) {
  return normalizeString(
    item?.publishStatus ||
    item?.fields?.['发布状态']
  );
}

function getItemPlanRelation(item) {
  return normalizeString(
    item?.planRelation ||
    item?.fields?.['是否关联广告计划']
  );
}

async function getAllCookies(domain) {
  try {
    return await chrome.cookies.getAll({ domain });
  } catch (error) {
    console.error('[Assistant] 获取 Cookie 失败:', error);
    return [];
  }
}

async function saveCookies() {
  const cookies = await getAllCookies(TARGET_DOMAIN);

  if (!cookies.length) {
    return { success: false, count: 0, message: '未找到任何 Cookie' };
  }

  const cookieData = cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
  }));

  await chrome.storage.local.set({
    [COOKIE_STORAGE_KEY]: {
      cookies: cookieData,
      savedAt: Date.now(),
      domain: TARGET_DOMAIN,
      count: cookieData.length,
    },
  });

  return { success: true, count: cookieData.length, message: `已保存 ${cookieData.length} 个 Cookie` };
}

async function restoreCookies() {
  const data = await chrome.storage.local.get([COOKIE_STORAGE_KEY]);
  const saved = data[COOKIE_STORAGE_KEY];

  if (!saved?.cookies?.length) {
    return { success: false, count: 0, message: '没有已保存的 Cookie' };
  }

  let restoredCount = 0;
  let failedCount = 0;

  for (const cookie of saved.cookies) {
    try {
      const details = {
        url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
      };

      if (cookie.expirationDate) {
        details.expirationDate = cookie.expirationDate < Date.now() / 1000
          ? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
          : cookie.expirationDate;
      }

      await chrome.cookies.set(details);
      restoredCount += 1;
    } catch (error) {
      console.error(`[Assistant] 恢复 Cookie 失败: ${cookie.name}`, error);
      failedCount += 1;
    }
  }

  return {
    success: restoredCount > 0,
    count: restoredCount,
    failed: failedCount,
    message: `已恢复 ${restoredCount} 个 Cookie${failedCount ? `，${failedCount} 个失败` : ''}`,
  };
}

async function clearCookies() {
  const cookies = await getAllCookies(TARGET_DOMAIN);
  let clearedCount = 0;

  for (const cookie of cookies) {
    try {
      const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      await chrome.cookies.remove({ url, name: cookie.name });
      clearedCount += 1;
    } catch (error) {
      console.error(`[Assistant] 清除 Cookie 失败: ${cookie.name}`, error);
    }
  }

  return { success: true, count: clearedCount, message: `已清除 ${clearedCount} 个 Cookie` };
}

async function checkLoginState() {
  const cookies = await getAllCookies(TARGET_DOMAIN);
  const keyCookies = cookies.filter((cookie) => KEY_COOKIE_NAMES.includes(cookie.name));
  const hasSessionCookie = cookies.some((cookie) =>
    cookie.name.includes('session') || cookie.name.includes('sid_') || cookie.name.includes('uid_')
  );

  const state = {
    isLoggedIn: hasSessionCookie,
    totalCookies: cookies.length,
    keyCookiesFound: keyCookies.map((cookie) => cookie.name),
    checkedAt: Date.now(),
  };

  await chrome.storage.local.set({ [LOGIN_STATE_KEY]: state });
  return state;
}

function buildSearchIndex(dataset) {
  const items = Array.isArray(dataset?.items) ? dataset.items : [];
  return {
    version: 1,
    generatedAt: Date.now(),
    totalItems: items.length,
    entries: items.map((item) => ({
      id: item.id,
      appId: getItemAppId(item),
      normalizedAppId: normalizeSearchValue(getItemAppId(item)),
      compactAppId: normalizeCompactValue(getItemAppId(item)),
      gameName: getItemGameName(item),
      normalizedGameName: normalizeSearchValue(getItemGameName(item)),
      compactGameName: normalizeCompactValue(getItemGameName(item)),
      publishStatus: getItemPublishStatus(item),
      planRelation: getItemPlanRelation(item),
      pageNo: Number(item.pageNo) || 0,
      itemIndex: Number(item.itemIndex) || 0,
    })),
  };
}

function doesItemMatchSearch(item, query = {}) {
  const itemAppId = getItemAppId(item);
  const itemGameName = getItemGameName(item);
  const itemPublishStatus = getItemPublishStatus(item);
  const itemPlanRelation = getItemPlanRelation(item);

  const normalizedItemAppId = normalizeSearchValue(itemAppId);
  const compactItemAppId = normalizeCompactValue(itemAppId);
  const normalizedItemGameName = normalizeSearchValue(itemGameName);
  const compactItemGameName = normalizeCompactValue(itemGameName);

  const normalizedRawText = normalizeSearchValue(item?.rawText || '');
  const compactRawText = normalizeCompactValue(item?.rawText || '');

  const queryTextMatch = !query.queryText || (
    normalizedItemAppId.includes(query.normalizedQueryText) ||
    compactItemAppId.includes(query.compactQueryText) ||
    normalizedItemGameName.includes(query.normalizedQueryText) ||
    compactItemGameName.includes(query.compactQueryText) ||
    normalizedRawText.includes(query.normalizedQueryText) ||
    compactRawText.includes(query.compactQueryText)
  );

  const publishStatusMatch = !query.publishStatus
    || normalizeSearchValue(itemPublishStatus) === query.normalizedPublishStatus;

  const planRelationMatch = !query.planRelation
    || normalizeSearchValue(itemPlanRelation) === query.normalizedPlanRelation;

  return queryTextMatch && publishStatusMatch && planRelationMatch;
}

async function setCrawlStatus(payload = {}) {
  const status = {
    state: payload.state || 'idle',
    message: payload.message || '',
    updatedAt: Date.now(),
    sourceUrl: payload.sourceUrl || TARGET_URL,
    pageNo: payload.pageNo || 0,
    totalPages: payload.totalPages || 0,
    totalItems: payload.totalItems || 0,
    error: payload.error || '',
  };

  await chrome.storage.local.set({ [DEMOGAME_CRAWL_STATUS_KEY]: status });
  return { success: true, status };
}

async function saveDemogameDataset(payload = {}) {
  const dataset = {
    version: 1,
    source: {
      url: payload.source?.url || TARGET_URL,
    },
    capturedAt: payload.capturedAt || Date.now(),
    totalPages: Number(payload.totalPages) || 0,
    totalItems: Array.isArray(payload.items) ? payload.items.length : 0,
    items: Array.isArray(payload.items) ? payload.items : [],
  };

  const searchIndex = buildSearchIndex(dataset);
  await chrome.storage.local.set({
    [DEMOGAME_DATASET_KEY]: dataset,
    [DEMOGAME_SEARCH_INDEX_KEY]: searchIndex,
    [DEMOGAME_CRAWL_STATUS_KEY]: {
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

  return {
    success: true,
    totalPages: dataset.totalPages,
    totalItems: dataset.totalItems,
    message: `已保存 ${dataset.totalItems} 条试玩管理记录`,
  };
}

async function getDemogameDatasetSummary() {
  const data = await chrome.storage.local.get([
    DEMOGAME_DATASET_KEY,
    DEMOGAME_CRAWL_STATUS_KEY,
  ]);
  const dataset = data[DEMOGAME_DATASET_KEY] || null;
  const crawlStatus = data[DEMOGAME_CRAWL_STATUS_KEY] || null;
  const items = Array.isArray(dataset?.items) ? dataset.items : [];
  const publishStatuses = Array.from(new Set(
    items.map((item) => getItemPublishStatus(item)).filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const planRelations = Array.from(new Set(
    items.map((item) => getItemPlanRelation(item)).filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, 'zh-CN'));

  return {
    success: true,
    hasData: Boolean(dataset?.items?.length),
    capturedAt: dataset?.capturedAt || null,
    totalPages: dataset?.totalPages || 0,
    totalItems: dataset?.totalItems || 0,
    sourceUrl: dataset?.source?.url || TARGET_URL,
    crawlStatus,
    filterOptions: {
      publishStatuses,
      planRelations,
    },
  };
}

async function searchDemogameItems(payload = {}) {
  const queryText = normalizeString(
    payload.queryText ||
    payload.keyword ||
    payload.appId ||
    payload.gameName
  );
  const publishStatus = normalizeString(payload.publishStatus);
  const planRelation = normalizeString(payload.planRelation);
  const normalizedQueryText = normalizeSearchValue(queryText);
  const compactQueryText = normalizeCompactValue(queryText);
  const normalizedPublishStatus = normalizeSearchValue(publishStatus);
  const normalizedPlanRelation = normalizeSearchValue(planRelation);

  const data = await chrome.storage.local.get([
    DEMOGAME_DATASET_KEY,
    DEMOGAME_SEARCH_INDEX_KEY,
  ]);

  const dataset = data[DEMOGAME_DATASET_KEY];
  let searchIndex = data[DEMOGAME_SEARCH_INDEX_KEY];

  if (!dataset?.items?.length) {
    return { success: false, message: '暂无抓取数据，请先执行抓取', items: [] };
  }

  if (!queryText && !publishStatus && !planRelation) {
    return { success: false, message: '请至少输入关键字或选择一个筛选条件', items: [] };
  }

  if (!searchIndex?.entries?.length || searchIndex.totalItems !== dataset.items.length) {
    searchIndex = buildSearchIndex(dataset);
    await chrome.storage.local.set({ [DEMOGAME_SEARCH_INDEX_KEY]: searchIndex });
  }

  const query = {
    queryText,
    normalizedQueryText,
    compactQueryText,
    publishStatus,
    normalizedPublishStatus,
    planRelation,
    normalizedPlanRelation,
  };

  const items = dataset.items
    .filter((item) => doesItemMatchSearch(item, query))
    .sort((left, right) => {
      const pageDelta = (left.pageNo || 0) - (right.pageNo || 0);
      if (pageDelta !== 0) return pageDelta;
      return (left.itemIndex || 0) - (right.itemIndex || 0);
    });

  return {
    success: true,
    total: items.length,
    items,
    message: items.length ? `找到 ${items.length} 条结果` : '未找到匹配结果',
  };
}

async function getDemogameItemDetail(payload = {}) {
  const id = normalizeString(payload.id);
  const data = await chrome.storage.local.get([DEMOGAME_DATASET_KEY]);
  const dataset = data[DEMOGAME_DATASET_KEY];
  const item = dataset?.items?.find((current) => current.id === id) || null;

  if (!item) {
    return { success: false, message: '未找到对应记录', item: null };
  }

  return { success: true, item };
}

async function clearDemogameDataset() {
  await chrome.storage.local.remove([
    DEMOGAME_DATASET_KEY,
    DEMOGAME_SEARCH_INDEX_KEY,
    DEMOGAME_CRAWL_STATUS_KEY,
  ]);

  return { success: true, message: '已清空试玩管理抓取数据' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const payload = message?.payload || {};

      switch (message?.action) {
        case 'saveCookies':
          sendResponse(await saveCookies());
          break;
        case 'restoreCookies':
          sendResponse(await restoreCookies());
          break;
        case 'clearCookies':
          sendResponse(await clearCookies());
          break;
        case 'checkLoginState':
          sendResponse(await checkLoginState());
          break;
        case 'getSavedInfo': {
          const data = await chrome.storage.local.get([COOKIE_STORAGE_KEY, LOGIN_STATE_KEY]);
          sendResponse({
            saved: data[COOKIE_STORAGE_KEY] || null,
            state: data[LOGIN_STATE_KEY] || null,
          });
          break;
        }
        case 'getAllCookies':
          sendResponse(await getAllCookies(TARGET_DOMAIN));
          break;
        case 'setCrawlStatus':
          sendResponse(await setCrawlStatus(payload));
          break;
        case 'saveDemogameDataset':
          sendResponse(await saveDemogameDataset(payload));
          break;
        case 'getDemogameDatasetSummary':
          sendResponse(await getDemogameDatasetSummary());
          break;
        case 'searchDemogameItems':
          sendResponse(await searchDemogameItems(payload));
          break;
        case 'getDemogameItemDetail':
          sendResponse(await getDemogameItemDetail(payload));
          break;
        case 'clearDemogameDataset':
          sendResponse(await clearDemogameDataset());
          break;
        default:
          sendResponse({ success: false, error: '未知操作' });
      }
    } catch (error) {
      console.error('[Assistant] 处理消息失败:', error);
      sendResponse({
        success: false,
        error: error?.message || '处理消息失败',
      });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Assistant] 扩展已安装/更新');
  await checkLoginState();
  await setCrawlStatus({ state: 'idle', message: '等待抓取' });
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (
    changeInfo.cookie.domain.includes('open-douyin.com') ||
    changeInfo.cookie.domain.includes('douyin.com')
  ) {
    setTimeout(async () => {
      await checkLoginState();
    }, 1000);
  }
});
