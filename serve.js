import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PUBLIC_DIR = path.resolve(process.cwd(), "public");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
};

const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname);
    if (pathname === "/" || pathname === "") pathname = "/index.html";

    const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("404 Bulunamadı");
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🧾 Better e-Arşiv Fatura (Sunucusuz / Jamstack)`);
    console.log(`🌐 Yerel Test Adresi: http://localhost:${PORT}`);
    console.log(`===============================================`);
});
