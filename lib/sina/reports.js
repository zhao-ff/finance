import { getJson } from '../common.js';
import { save, outputResult } from '../storage.js';

const BASE_URL = 'https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022';

const SOURCE_MAP = {
  'key_metrics': 'gjzb',
  'balance': 'fzb',
  'income': 'lrb',
  'cash_flow': 'llb',
};

function toSinaPaperCode(code) {
  if (!code) return null;

  const cleanCode = code.trim().toUpperCase();
  let numericPart;
  let exchangePrefix = null;

  if (cleanCode.endsWith('.SH')) {
    numericPart = cleanCode.slice(0, -3);
    exchangePrefix = 'sh';
  } else if (cleanCode.endsWith('.SZ')) {
    numericPart = cleanCode.slice(0, -3);
    exchangePrefix = 'sz';
  } else if (cleanCode.startsWith('SH')) {
    numericPart = cleanCode.slice(2);
    exchangePrefix = 'sh';
  } else if (cleanCode.startsWith('SZ')) {
    numericPart = cleanCode.slice(2);
    exchangePrefix = 'sz';
  } else if (cleanCode.match(/^\d+$/)) {
    numericPart = cleanCode;
    if (numericPart.length < 6) {
      numericPart = numericPart.padStart(6, '0');
    }
    exchangePrefix = inferExchange(numericPart);
  } else {
    return null;
  }

  if (!numericPart.match(/^\d+$/)) return null;
  if (!exchangePrefix) return null;

  return exchangePrefix + numericPart;
}

function inferExchange(code) {
  if (code.length < 2) return null;

  const prefix2 = code.slice(0, 2);
  const prefix1 = code.slice(0, 1);

  if (prefix2 === '60' || prefix2 === '68' || prefix1 === '5') {
    return 'sh';
  }

  if (prefix2 === '00' || prefix2 === '30' || prefix1 === '1' || prefix1 === '2') {
    return 'sz';
  }

  return null;
}

function condenseReportData(data) {
  if (!data?.result?.data?.report_list) return data;

  const reportList = data.result.data.report_list;
  for (const date of Object.keys(reportList)) {
    const entry = reportList[date];
    if (entry?.data && Array.isArray(entry.data)) {
      const condensed = {};
      for (const item of entry.data) {
        condensed[item.item_title] = item.item_value;
      }
      entry.data = condensed;
    }
  }
  return data;
}

export async function reports(options) {
  const code = options.code;
  const type = parseInt(options.type || '0', 10);
  const source = SOURCE_MAP[options.source] || options.source;
  const page = parseInt(options.page || '1', 10);
  const num = parseInt(options.num || '10', 10);

  const paperCode = toSinaPaperCode(code);
  if (!paperCode) {
    console.error('Invalid stock code:', code);
    process.exit(1);
  }

  const url = `${BASE_URL}?paperCode=${paperCode}&source=${source}&type=${type}&page=${page}&num=${num}`;
  const data = await getJson(url);

  condenseReportData(data);

  if (!options.output) {
    await save('reports', data, code);
  }

  await outputResult(data, options);
}
