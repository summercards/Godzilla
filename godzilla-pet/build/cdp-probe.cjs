/* 一次性诊断：检查拖动区域 CSS 到底有没有进到页面里。
 * 用法：node build/cdp-probe.cjs <port> [表达式文件]
 */
'use strict';
const fs = require('node:fs');
const port = Number(process.argv[2] || 9231);
const exprFile = process.argv[3];
const base = `http://127.0.0.1:${port}`;

const DEFAULT_EXPR = `(() => {
  const out = {};
  out.href = location.href;
  out.title = document.title;
  out.innerW = innerWidth; out.innerH = innerHeight;
  const body = document.body;
  const shell = document.querySelector('.shell');
  out.hasShell = !!shell;
  const cs = getComputedStyle(body);
  out.body_jsProp = String(cs.webkitAppRegion);
  out.body_getProp = cs.getPropertyValue('-webkit-app-region');
  out.shell_jsProp = shell ? String(getComputedStyle(shell).webkitAppRegion) : 'no-shell';
  out.shell_getProp = shell ? getComputedStyle(shell).getPropertyValue('-webkit-app-region') : 'no-shell';
  out.styleSheetCount = document.styleSheets.length;
  out.headStyleTags = document.querySelectorAll('style').length;
  out.bodyInlineStyle = body.getAttribute('style');
  return JSON.stringify(out);
})()`;

async function main() {
  const list = await (await fetch(`${base}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) { console.log('没有 page 目标'); console.log(JSON.stringify(list, null, 2)); return; }
  console.log('url   =', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  const expr = exprFile ? fs.readFileSync(exprFile, 'utf8') : DEFAULT_EXPR;
  const value = await new Promise((resolve) => {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== 1) return;
      if (m.error) { resolve('CDP 错误：' + JSON.stringify(m.error)); return; }
      const r = m.result?.result;
      resolve(r?.value !== undefined ? String(r.value) : JSON.stringify(r));
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: false } }));
  });
  try {
    console.log(JSON.stringify(JSON.parse(value), null, 2));
  } catch {
    console.log(value);
  }
  ws.close();
}

main().catch((e) => { console.error('探测失败：', e.message); process.exit(1); });
