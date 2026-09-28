// static-server.mjs — 本地静态托管，供视觉回归与字体断言使用
// 教训：缺文件时**不能**一律回退 index.html。带扩展名的请求必须 404，
// 否则会把 HTML 当 CSS/JS 返回，页面变成「样式全废 + Unexpected token '<'」，
// 而你会以为是站点坏了。另外 root 必须先归一成原生路径——Windows 下
// path.join 产出反斜杠，与配置里的正斜杠做 startsWith 会永远失败。

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.map': 'application/json'
};

export function serveStatic(rootDir, port) {
  const root = resolve(rootDir);
  const sep = process.platform === 'win32' ? '\\' : '/';
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(root, '.' + p);
    const inside = file === root || file.startsWith(root + sep);
    let isFile = false;
    try { isFile = inside && existsSync(file) && statSync(file).isFile(); } catch (e) { isFile = false; }
    if (isFile) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    if (!extname(p)) {
      const idx = join(root, 'index.html');
      if (existsSync(idx)) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(idx)); return; }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 ' + p);
  });
  return new Promise(function (r) { server.listen(port, '127.0.0.1', function () { r(server); }); });
}
