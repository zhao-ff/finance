import { spawnSync } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import fetch from 'node-fetch';

const REQUEST_TIMEOUT = 30000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function solveWafChallenge(html) {
  const match = html.match(/<script>(.*?)<\/script>/s);
  if (!match) return null;

  const jsCode = match[1];
  const wrapper = `
var location = { host: "static.sse.com.cn", hostname: "static.sse.com.cn" };
var _capturedCookie = "";
var document = { location: { reload: function() {} } };
Object.defineProperty(document, "cookie", {
    set: function(val) { _capturedCookie = val; },
    get: function() { return _capturedCookie; },
    configurable: true
});
${jsCode}
console.log(_capturedCookie || "NO_COOKIE");
`;

  try {
    const result = spawnSync('node', ['-e', wrapper], {
      timeout: 10000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) {
      console.error(`[SSE] Node.js 执行 WAF 挑战失败: ${result.stderr?.slice(0, 200)}`);
      return null;
    }

    const output = result.stdout.trim();
    const cookieMatch = output.match(/acw_sc__v2=([^;]+)/);
    if (cookieMatch) return cookieMatch[1];

    return null;
  } catch (e) {
    console.error(`[SSE] WAF 挑战异常: ${e.message}`);
    return null;
  }
}

export async function downloadPdf(url, outputPath) {
  const acwMatch = url.match(/\/\/static\.sse\.com\.cn/i);

  // 第一次请求（可能被 WAF 拦截）
  const resp = await fetch(url, { headers: HEADERS, timeout: REQUEST_TIMEOUT });
  const contentType = resp.headers.get('content-type') || '';

  if (contentType.includes('text/html') && resp.headers.get('x-tengine-error') === 'denied by bot') {
    const html = await resp.text();
    console.error(`  [SSE] 检测到 WAF 挑战，计算 cookie...`);

    const cookieVal = solveWafChallenge(html);
    if (!cookieVal) {
      console.error(`  [SSE] WAF 挑战失败`);
      return false;
    }

    // 带 cookie 重新请求
    const resp2 = await fetch(url, {
      headers: { ...HEADERS, Cookie: `acw_sc__v2=${cookieVal}` },
      timeout: REQUEST_TIMEOUT,
    });

    const buffer = Buffer.from(await resp2.arrayBuffer());
    if (buffer.slice(0, 4).toString() !== '%PDF') {
      console.error(`  [SSE] 下载结果非 PDF，可能 WAF 仍未通过`);
      return false;
    }

    await writeFile(outputPath, buffer);
    return true;
  }

  // 没有 WAF 拦截
  if (contentType.includes('application/pdf') || contentType.includes('application/octet-stream') || contentType.includes('text/plain')) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    await writeFile(outputPath, buffer);
    return true;
  }

  // 检查是否是 PDF 魔术字节
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.slice(0, 4).toString() === '%PDF') {
    await writeFile(outputPath, buffer);
    return true;
  }

  console.error(`  [SSE] 未知响应类型: ${contentType}`);
  return false;
}

export async function downloadSSERecords(records, downloadDir) {
  await mkdir(downloadDir, { recursive: true });

  for (const record of records) {
    if (!record.url) continue;

    const originalName = basename(record.url) || 'download.pdf';
    const datePart = record.sseDate ? record.sseDate.slice(0, 10) : 'unknown';
    const filename = `${record.securityCode}_${datePart}_${originalName}`;
    const filepath = join(downloadDir, filename);

    process.stderr.write(`[SSE] 下载: ${filename} ... `);
    const ok = await downloadPdf(record.url, filepath);
    if (ok) {
      console.error(`✓ ${filename}`);
    } else {
      console.error(`✗ ${filename}`);
    }
  }
}
