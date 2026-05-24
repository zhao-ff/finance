import { writeFile, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import fetch from 'node-fetch';
import { fetchBulletinData as fetchSSE } from './sse/bulletin.js';
import { fetchBulletinData as fetchSZSE } from './szse/bulletin.js';
import { downloadSSERecords } from './sse/download.js';
import { save, outputResult } from './storage.js';

const EXCHANGE_MAP = {
  sse: 'sse',
  szse: 'szse',
  all: 'all',
};

async function downloadSZSEFiles(records, downloadDir) {
  await mkdir(downloadDir, { recursive: true });

  for (const record of records) {
    if (!record.url) continue;

    const originalName = basename(record.url) || 'download.pdf';
    const datePart = record.sseDate ? record.sseDate.slice(0, 10) : 'unknown';
    const filename = `${record.securityCode}_${datePart}_${originalName}`;
    const filepath = join(downloadDir, filename);

    try {
      const resp = await fetch(record.url);
      if (!resp.ok) {
        console.error(`下载失败 [${resp.status}] ${filename}`);
        continue;
      }
      const buffer = Buffer.from(await resp.arrayBuffer());
      await writeFile(filepath, buffer);
      console.error(`已下载: ${filename}`);
    } catch (e) {
      console.error(`下载出错 ${filename}: ${e.message}`);
    }
  }
}

async function downloadFiles(records, downloadDir) {
  const sseRecords = records.filter(r => r.exchange === 'sse');
  const szseRecords = records.filter(r => r.exchange === 'szse' || !r.exchange);

  if (szseRecords.length > 0) {
    await downloadSZSEFiles(szseRecords, downloadDir);
  }
  if (sseRecords.length > 0) {
    await downloadSSERecords(sseRecords, downloadDir);
  }
}

export async function bulletin(options) {
  const exchange = EXCHANGE_MAP[options.exchange] || 'all';

  let allRecords = [];

  if (exchange === 'sse' || exchange === 'all') {
    const sseRecords = await fetchSSE(options);
    for (const r of sseRecords) {
      r.exchange = 'sse';
    }
    allRecords = allRecords.concat(sseRecords);
  }

  if (exchange === 'szse' || exchange === 'all') {
    const szseRecords = await fetchSZSE(options);
    for (const r of szseRecords) {
      r.exchange = 'szse';
    }
    allRecords = allRecords.concat(szseRecords);
  }

  // 如果指定了股票代码，过滤出匹配的记录
  if (options.code) {
    allRecords = allRecords.filter(r => r.securityCode === options.code);
  }

  // 按日期降序排列
  allRecords.sort((a, b) => {
    const dateA = a.sseDate || '';
    const dateB = b.sseDate || '';
    return dateB.localeCompare(dateA);
  });

  if (allRecords.length === 0) {
    console.error('未获取到数据');
    return;
  }

  // 下载PDF附件
  if (options.download) {
    await downloadFiles(allRecords, options.download);
  }

  if (!options.output) {
    await save('bulletin', allRecords, options.code);
  }

  await outputResult(allRecords, options);
}
