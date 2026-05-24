import fetch from 'node-fetch';
import { save, outputResult } from '../storage.js';

const API_URL = 'https://www.szse.cn/api/disc/announcement/annList';
const REFERER = 'https://www.szse.cn/disclosure/listed/notice/index.html';

// 公告类型映射
const BULLETIN_TYPE_MAP = {
  'annual': '010301',          // 年度报告
  'q3': '010307',              // 三季度
  'mid': '010303',             // 半年度
  'q1': '010305',              // 一季度
  'ipo': '0102',               // 首次公开发行
  'sharechange': '0115',       // 股权变动
  'risk': '0121',              // 澄清、风险提示、业绩预告事项
};

// 板块类型映射
const PLATE_CODE_MAP = {
  'main': '11',      // 主板（0开头）
  'gem': '16',       // 创业板
};

function parseOptions(options) {
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

  let bigCategoryId = options.bulletinType;
  if (bigCategoryId && BULLETIN_TYPE_MAP[bigCategoryId]) {
    bigCategoryId = BULLETIN_TYPE_MAP[bigCategoryId];
  }

  let plateCode = options.plateType;
  if (plateCode && PLATE_CODE_MAP[plateCode]) {
    plateCode = PLATE_CODE_MAP[plateCode];
  }

  const title = options.title?.replace(/'/g, '');

  return { startDate, endDate, bigCategoryId, plateCode, title };
}

export async function fetchBulletinData(options = {}) {
  const { startDate, endDate, bigCategoryId, plateCode, title } = parseOptions(options);
  const securityCode = options.code;
  const pageSize = parseInt(options.pageSize || '50', 10);
  const pageNum = parseInt(options.pageNum || '1', 10);

  const payload = {
    seDate: [startDate, endDate],
    channelCode: ['listedNotice_disc'],
    pageSize,
    pageNum,
  };

  if (securityCode) payload.stockCode = [securityCode];
  if (bigCategoryId) payload.bigCategoryId = [bigCategoryId];
  if (plateCode) payload.plateCode = [plateCode];
  if (title) payload.searchKey = [title];

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': REFERER,
      'Content-Type': 'application/json',
      'Origin': 'https://www.szse.cn',
    },
    body: JSON.stringify(payload),
  });

  const root = await resp.json();

  if (!root || !root.data || !Array.isArray(root.data)) {
    return [];
  }

  const allRecords = [];
  for (const item of root.data) {
    if (item && typeof item === 'object') {
      allRecords.push({
        sseDate: item.publishTime,
        securityCode: item.secCode?.[0],
        securityName: item.secName?.[0],
        title: item.title,
        url: item.attachPath ? `https://disc.static.szse.cn/download${item.attachPath}` : null,
        id: item.id,
        columnId: item.columnId,
        pageURL: item.pageURL ? `https://www.szse.cn${item.pageURL}` : null,
      });
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
    await save('szse-bulletin', allRecords, options.code);
  }

  await outputResult(allRecords, options);
}
