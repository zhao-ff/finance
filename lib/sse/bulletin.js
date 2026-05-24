import fetch from 'node-fetch';
import { save, outputResult } from '../storage.js';

const API_URL = 'https://query.sse.com.cn/security/stock/queryCompanyBulletinNew.do';
const JSONP_CALLBACK_NAME = 'fetchCallback';

// 公告类型映射
const BULLETIN_TYPE_MAP = {
  'suspend': '36',           // 停复牌提示性公告
  'risk': '31',              // 风险警示
  'major': '29',             // 其他重大事项
  'repurchase': '21',        // 回购股份
  'restructuring': '19',     // 重大资产重组
  'sharechange': '15',       // 股东增持或减持股份
  'performance': '11',       // 业绩预告、业绩快报和盈利预测
  'periodic': '00,0101,0102,0104,0103',  // 定期报告
  'annual': '0101',          // 年报
  'q1': '0102',              // 一季报
  'mid': '0103',             // 半年报
  'q3': '0104',              // 三季报
};

// 板块类型映射
const STOCK_TYPE_MAP = {
  'main': '1',     // 主板
  'star': '2',     // 科创板
};

function cleanJsonp(response, callbackName) {
  if (!response || !response.trim()) {
    return null;
  }
  const prefix = callbackName + '(';
  const suffix = ')';

  const trimmed = response.trim();
  if (trimmed.startsWith(prefix) && trimmed.endsWith(suffix)) {
    return trimmed.substring(prefix.length, trimmed.length - suffix.length);
  }
  return trimmed;
}

function parseOptions(options) {
  const securityCode = options.code;
  let startDate = options.startDate?.replace(/'/g, '');
  let endDate = options.endDate?.replace(/'/g, '');

  const today = new Date();
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(today.getMonth() - 3);

  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  if (!endDate) endDate = formatDate(today);
  if (!startDate) startDate = formatDate(threeMonthsAgo);

  const start = new Date(startDate);
  const end = new Date(endDate);
  const maxEnd = new Date(start);
  maxEnd.setMonth(start.getMonth() + 3);

  if (end > maxEnd) {
    throw new Error('开始时间和结束时间的间隔不能超过三个月');
  }

  let bulletinType = options.bulletinType;
  if (bulletinType && BULLETIN_TYPE_MAP[bulletinType]) {
    bulletinType = BULLETIN_TYPE_MAP[bulletinType];
  }

  let stockType = options.stockType;
  if (stockType && STOCK_TYPE_MAP[stockType]) {
    stockType = STOCK_TYPE_MAP[stockType];
  }

  const title = options.title?.replace(/'/g, '');

  return { securityCode, startDate, endDate, bulletinType, stockType, title };
}

export async function fetchBulletinData(options = {}) {
  const { securityCode, startDate, endDate, bulletinType, stockType, title } = parseOptions(options);
  const pageSize = parseInt(options.pageSize || '25', 10);
  const pageNo = parseInt(options.pageNo || '1', 10);

  const params = new URLSearchParams();
  params.append('jsonCallBack', JSONP_CALLBACK_NAME);
  params.append('isPagination', 'true');
  params.append('pageHelp.pageSize', String(pageSize));
  params.append('pageHelp.pageNo', String(pageNo));
  params.append('pageHelp.cacheSize', '1');
  params.append('pageHelp.beginPage', '1');
  params.append('pageHelp.endPage', '1');

  if (securityCode) params.append('SECURITY_CODE', securityCode);
  if (startDate) params.append('START_DATE', startDate);
  if (endDate) params.append('END_DATE', endDate);
  if (bulletinType) params.append('BULLETIN_TYPE', bulletinType);
  if (stockType) params.append('stockType', stockType);
  if (title) params.append('TITLE', title);
  params.append('_', String(Date.now()));

  const url = `${API_URL}?${params.toString()}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.sse.com.cn/disclosure/listedinfo/announcement/',
    },
  });

  const text = await resp.text();
  const jsonString = cleanJsonp(text, JSONP_CALLBACK_NAME);

  if (!jsonString || !jsonString.trim()) {
    return [];
  }

  const root = JSON.parse(jsonString);
  const resultList = root.result;

  if (!resultList || !Array.isArray(resultList)) {
    return [];
  }

  const allRecords = [];
  for (const item of resultList) {
    if (Array.isArray(item)) {
      for (const obj of item) {
        if (obj && typeof obj === 'object') {
          allRecords.push({
            sseDate: obj.SSEDATE,
            securityCode: obj.SECURITY_CODE,
            securityName: obj.SECURITY_NAME,
            title: obj.TITLE,
            url: obj.URL ? `https://static.sse.com.cn${obj.URL}` : null,
          });
        }
      }
    }
  }

  return allRecords;
}

export async function bulletin(options) {
  const allRecords = await fetchBulletinData(options);

  if (allRecords.length === 0) {
    console.error('未获取到数据');
    return;
  }

  if (!options.output) {
    await save('sse-bulletin', allRecords, options.code);
  }

  await outputResult(allRecords, options);
}
