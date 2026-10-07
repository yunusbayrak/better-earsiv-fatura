import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import { GibClient } from "./gibClient.js";
import type { EnvironmentKey, InvoiceListItem } from "./gibClient.js";
import { convertHtmlToPdf, findBrowserExecutable } from "./pdfUtil.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PUBLIC_DIR = path.resolve(process.cwd(), "public");

// --- SERVER-SIDE LOG SYSTEM ---
export interface ServerLogEntry {
    id: number;
    timestamp: string;
    level: "INFO" | "WARN" | "ERROR" | "DEBUG";
    category: "HTTP" | "GIB" | "INVOICE" | "AUTH" | "SYSTEM";
    message: string;
    details?: unknown;
}

let logCounter = 0;
const MAX_LOGS = 300;
const serverLogs: ServerLogEntry[] = [];
const sseClients = new Set<http.ServerResponse>();

export function logServer(
    level: ServerLogEntry["level"],
    category: ServerLogEntry["category"],
    message: string,
    details?: unknown
): void {
    const entry: ServerLogEntry = {
        id: ++logCounter,
        timestamp: new Date().toLocaleTimeString("tr-TR", { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0"),
        level,
        category,
        message,
        details,
    };

    serverLogs.push(entry);
    if (serverLogs.length > MAX_LOGS) {
        serverLogs.shift();
    }

    // Terminal console format
    const prefix = `[${entry.timestamp}] [${entry.level}] [${entry.category}]`;
    if (level === "ERROR") {
        console.error(`${prefix} ${message}`, details !== undefined ? details : "");
    } else if (level === "WARN") {
        console.warn(`${prefix} ${message}`, details !== undefined ? details : "");
    } else {
        console.log(`${prefix} ${message}`, details !== undefined ? details : "");
    }

    // SSE Canlı Yayın (Bağlı tarayıcılara anında ilet)
    const sseData = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(sseData);
        } catch {
            sseClients.delete(client);
        }
    }
}

// Token -> Girişte kullanılan Kullanıcı Kodu haritası
const tokenUserCodeMap = new Map<string, string>();

// ETTN + Durum -> PDF arabelleği (Bellek önbelleği, aynı faturanın tekrar PDF dönüştürülmesini önler)
const invoicePdfCache = new Map<string, { buffer: Buffer; timestamp: number }>();
const MAX_PDF_CACHE_ENTRIES = 50;
const PDF_CACHE_TTL_MS = 30 * 60 * 1000; // 30 dakika

function getCachedPdf(key: string): Buffer | null {
    const entry = invoicePdfCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > PDF_CACHE_TTL_MS) {
        invoicePdfCache.delete(key);
        return null;
    }
    return entry.buffer;
}

function setCachedPdf(key: string, buffer: Buffer): void {
    if (invoicePdfCache.size >= MAX_PDF_CACHE_ENTRIES) {
        const oldestKey = invoicePdfCache.keys().next().value;
        if (oldestKey) invoicePdfCache.delete(oldestKey);
    }
    invoicePdfCache.set(key, { buffer, timestamp: Date.now() });
}

const MIME_TYPES: Record<string, string> = {
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

/** GİB tarih formatını (GG/AA/YYYY) Date nesnesine dönüştürür */
function parseGibDateString(str: string): Date {
    const parts = str.split("/").map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return new Date();
}

/** Date nesnesini GİB tarih formatına (GG/AA/YYYY) dönüştürür */
function formatGibDateString(date: Date): string {
    const d = date.getDate().toString().padStart(2, "0");
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
}

/** İki GİB tarih formatı (GG/AA/YYYY) arasındaki takvim günü farkını hesaplar (başlangıç ve bitiş dahil) */
function getGibDateRangeDays(startStr: string, endStr: string): number {
    const start = parseGibDateString(startStr);
    const end = parseGibDateString(endStr);
    const msDiff = end.getTime() - start.getTime();
    return Math.round(msDiff / (24 * 60 * 60 * 1000)) + 1;
}

/** JSON gövdesini (request body) parse eder */
function readJsonBody<T = unknown>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk: Buffer | string) => {
            body += chunk.toString();
            if (body.length > 1e7) {
                // 10MB limit
                req.destroy();
                reject(new Error("Request body too large"));
            }
        });
        req.on("end", () => {
            if (!body.trim()) {
                resolve({} as T);
                return;
            }
            try {
                resolve(JSON.parse(body) as T);
            } catch (err) {
                reject(new Error("Geçersiz JSON verisi: " + (err as Error).message));
            }
        });
        req.on("error", reject);
    });
}

/** JSON yanıt gönderir */
function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(data));
}

/** Statik dosya sunar (ETag, 304 Not Modified ve Gzip desteği ile) */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
    const safePath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("403 Forbidden");
        return;
    }

    fs.stat(filePath, (err: NodeJS.ErrnoException | null, stats: fs.Stats | undefined) => {
        if (err || !stats || !stats.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("404 Not Found");
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const etag = `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;

        // 304 Not Modified kontrolü
        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, {
                "ETag": etag,
                "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
            });
            res.end();
            return;
        }

        const acceptEncoding = (req.headers["accept-encoding"] as string) || "";
        const canGzip = /\bgzip\b/.test(acceptEncoding) && (
            contentType.startsWith("text/") ||
            contentType.startsWith("application/javascript") ||
            contentType.startsWith("application/json")
        );

        const responseHeaders: Record<string, string | number> = {
            "Content-Type": contentType,
            "ETag": etag,
            "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
        };

        if (canGzip) {
            responseHeaders["Content-Encoding"] = "gzip";
            res.writeHead(200, responseHeaders);
            const rawStream = fs.createReadStream(filePath);
            const gzip = zlib.createGzip({ level: 6 });
            rawStream.pipe(gzip).pipe(res);
        } else {
            responseHeaders["Content-Length"] = stats.size;
            res.writeHead(200, responseHeaders);
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
        }
    });
}

/** GİB Test ve Canlı portal istemcisi oluşturur. */
function getGibClient(env: EnvironmentKey): GibClient {
    return new GibClient(env);
}

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // CORS headers for local usage
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = reqUrl.pathname;

    // Canlı Log SSE Yayını
    if (pathname === "/api/logs/stream" && req.method === "GET") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        });
        res.write(`data: ${JSON.stringify({ id: 0, timestamp: new Date().toLocaleTimeString("tr-TR"), level: "INFO", category: "SYSTEM", message: "Log akışı bağlandı" })}\n\n`);
        sseClients.add(res);
        req.on("close", () => {
            sseClients.delete(res);
        });
        return;
    }

    // Mevcut Logları Getir
    if (pathname === "/api/logs" && req.method === "GET") {
        sendJson(res, 200, { success: true, logs: serverLogs });
        return;
    }

    // Logları Temizle
    if (pathname === "/api/logs/clear" && req.method === "POST") {
        serverLogs.length = 0;
        logServer("INFO", "SYSTEM", "Log kayıtları temizlendi.");
        sendJson(res, 200, { success: true });
        return;
    }

    try {
        // --- API ROUTES ---
        if (pathname.startsWith("/api/")) {
            logServer("INFO", "HTTP", `--> ${req.method} ${pathname}`);

            // 1. Giriş Yap (Token Al)
            if (pathname === "/api/login" && req.method === "POST") {
                const body = await readJsonBody<{ env?: EnvironmentKey; username?: string; password?: string }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                if (!body.username || !body.password) {
                    logServer("WARN", "AUTH", "Giriş başarısız: Eksik kullanıcı adı veya parola");
                    sendJson(res, 400, { success: false, error: "Kullanıcı adı ve parola zorunludur." });
                    return;
                }

                logServer("INFO", "AUTH", `Giriş deneniyor: Ortam=${env}, Kullanıcı=${body.username}`);
                const client = getGibClient(env);
                let token: string;
                try {
                    token = await client.getToken(body.username, body.password);
                    logServer("INFO", "AUTH", `Giriş başarılı (anologin)! Token alındı: ${token.substring(0, 8)}...`);
                } catch (err: unknown) {
                    logServer("WARN", "AUTH", `anologin başarısız oldu, "login" komutu deneniyor... Hata: ${err instanceof Error ? err.message : String(err)}`);
                    try {
                        client.loginCmd = "login";
                        token = await client.getToken(body.username, body.password);
                        logServer("INFO", "AUTH", `Giriş başarılı (login fallback)! Token: ${token.substring(0, 8)}...`);
                    } catch (fallbackErr: unknown) {
                        const errMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
                        logServer("ERROR", "AUTH", `Giriş tamamen başarısız oldu: ${errMsg}`);
                        throw fallbackErr;
                    }
                }

                if (token && body.username) {
                    tokenUserCodeMap.set(token, body.username);
                }

                sendJson(res, 200, { success: true, token, env, username: body.username });
                return;
            }

            // 2. Çıkış Yap
            if (pathname === "/api/logout" && req.method === "POST") {
                const body = await readJsonBody<{ env?: EnvironmentKey; token?: string }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                logServer("INFO", "AUTH", `Çıkış isteği alındı (Ortam=${env})`);
                if (body.token) {
                    tokenUserCodeMap.delete(body.token);
                    const client = getGibClient(env);
                    try {
                        await client.logout(body.token);
                        logServer("INFO", "AUTH", "GİB oturumu başarıyla kapatıldı.");
                    } catch (err: unknown) {
                        logServer("WARN", "AUTH", `GİB logout uyarısı: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                sendJson(res, 200, { success: true });
                return;
            }

            // 3. VKN / TCKN ile Alıcı Bilgisi Sorgula
            if (pathname === "/api/recipient" && req.method === "POST") {
                const body = await readJsonBody<{ env?: EnvironmentKey; token?: string; taxId?: string }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                if (!body.token || !body.taxId) {
                    logServer("WARN", "HTTP", "Alıcı sorgulama: Token veya vergi no eksik");
                    sendJson(res, 400, { success: false, error: "Token ve VKN/TCKN zorunludur." });
                    return;
                }

                logServer("INFO", "GIB", `Alıcı sorgulanıyor: VKN/TCKN=${body.taxId} (${env})`);
                const client = getGibClient(env);
                const data = await client.getRecipientData(body.token, body.taxId);
                logServer("INFO", "GIB", `Alıcı sorgulandı: ${JSON.stringify(data)}`);
                sendJson(res, 200, { success: true, data });
                return;
            }

            // 4. Faturaları Listele (Tarih Aralığı Kontrolü - En Fazla 7 Gün)
            if (pathname === "/api/invoices" && req.method === "POST") {
                const body = await readJsonBody<{
                    env?: EnvironmentKey;
                    token?: string;
                    startDate?: string;
                    endDate?: string;
                    issuedToMe?: boolean;
                }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                if (!body.token || !body.startDate || !body.endDate) {
                    sendJson(res, 400, { success: false, error: "Token, başlangıç ve bitiş tarihi zorunludur." });
                    return;
                }

                // Tarih doğrulaması
                const startD = parseGibDateString(body.startDate);
                const endD = parseGibDateString(body.endDate);
                if (startD > endD) {
                    logServer("WARN", "GIB", `Geçersiz tarih aralığı: ${body.startDate} - ${body.endDate} (Başlangıç bitişten sonra)`);
                    sendJson(res, 400, { success: false, error: "Başlangıç tarihi bitiş tarihinden sonra olamaz." });
                    return;
                }

                const dayCount = getGibDateRangeDays(body.startDate, body.endDate);
                if (dayCount > 7) {
                    logServer("WARN", "GIB", `Tarih aralığı 7 günü aşıyor: ${body.startDate} - ${body.endDate} (${dayCount} gün)`);
                    sendJson(res, 400, {
                        success: false,
                        error: `GİB e-Arşiv kuralı gereği tarih aralığı en fazla 7 gün olabilir. Seçilen aralık: ${dayCount} gün. Lütfen en fazla 7 günlük bir aralık seçiniz.`,
                    });
                    return;
                }

                logServer("INFO", "GIB", `Faturalar sorgulanıyor: ${body.startDate} - ${body.endDate} (${dayCount} gün, Alıcı=${!!body.issuedToMe}, Ortam=${env})`);
                const client = getGibClient(env);

                try {
                    let invoices: InvoiceListItem[];
                    if (body.issuedToMe) {
                        invoices = await client.getIncomingInvoices(body.token, body.startDate, body.endDate);
                    } else {
                        invoices = await client.getOutgoingInvoices(body.token, body.startDate, body.endDate);
                    }

                    const list = Array.isArray(invoices) ? invoices : [];
                    // Faturaları tarihe göre azalan (en yeni en üstte) sırala
                    list.sort((a, b) => {
                        const tA = String(a.belgeTarihi || a.faturaTarihi || a.date || "");
                        const tB = String(b.belgeTarihi || b.faturaTarihi || b.date || "");
                        return tB.localeCompare(tA);
                    });

                    logServer("INFO", "GIB", `${list.length} adet fatura başarıyla listelendi (${body.startDate} - ${body.endDate}).`);
                    sendJson(res, 200, { success: true, data: list });
                } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    logServer("ERROR", "GIB", `Fatura listeleme hatası: ${errMsg}`);
                    sendJson(res, 500, { success: false, error: errMsg });
                }
                return;
            }

            // 5. Fatura Oluştur (Taslak veya İmzalı)
            if (pathname === "/api/invoices/create" && req.method === "POST") {
                const body = await readJsonBody<{
                    env?: EnvironmentKey;
                    token?: string;
                    invoiceDetails?: Record<string, unknown>;
                    sign?: boolean;
                }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                if (!body.token || !body.invoiceDetails) {
                    logServer("WARN", "INVOICE", "Fatura oluşturma: Token veya fatura detayları eksik.");
                    sendJson(res, 400, { success: false, error: "Token ve fatura detayları zorunludur." });
                    return;
                }

                const client = getGibClient(env);
                
                // GİB ETTN için standart 36 karakter RFC UUID v4 üret
                const rawUuid = typeof body.invoiceDetails.uuid === "string" ? body.invoiceDetails.uuid : "";
                const generatedUuid = rawUuid && rawUuid.length === 36
                    ? rawUuid
                    : crypto.randomUUID();

                logServer("INFO", "INVOICE", `Taslak fatura oluşturma başlatıldı (${env}). Hedef UUID: ${generatedUuid}`);

                // Türkçe / İngilizce alan isimlerini eşitleyelim
                const inv = body.invoiceDetails;
                const userEnteredNote = typeof inv.note === "string" ? inv.note.trim() : typeof inv.not === "string" ? inv.not.trim() : "";

                const invoiceType = String(inv.invoiceType || inv.faturaTipi || "SATIS");
                const currency = String(inv.currency || inv.paraBirimi || "TRY");
                const currencyRate = String(inv.currencyRate || inv.dovzTLkur || "0");
                const country = String(inv.country || inv.ulke || "Türkiye");
                const taxIDOrTRID = String(inv.taxIDOrTRID || inv.vknTckn || "11111111111");
                const title = String(inv.title || inv.aliciUnvan || "");
                const name = String(inv.name || inv.aliciAdi || "");
                const surname = String(inv.surname || inv.aliciSoyadi || "");
                const fullAddress = String(inv.fullAddress || inv.bulvarcaddesokak || "");
                const taxOffice = String(inv.taxOffice || inv.vergiDairesi || "");
                const date = String(inv.date || "");
                const time = String(inv.time || "12:00:00");
                const grandTotal = Number(inv.grandTotal || 0);
                const totalVAT = Number(inv.totalVAT || 0);
                const grandTotalInclVAT = Number(inv.grandTotalInclVAT || 0);
                const paymentTotal = Number(inv.paymentTotal || 0);

                // Mal / Hizmet tablosu formatı
                const itemsList = Array.isArray(inv.items) ? inv.items : [];
                const malHizmetTable = itemsList.map((item) => {
                    const it = item as Record<string, unknown>;
                    const qty = Number(it.quantity ?? it.miktar ?? 1);
                    const unitPrice = Number(it.unitPrice ?? it.birimFiyat ?? 0);
                    const price = Number(it.price ?? it.fiyat ?? qty * unitPrice);
                    const vatRate = Number(it.VATRate ?? it.kdvOrani ?? 0);
                    const vatAmount = Number(it.VATAmount ?? it.kdvTutari ?? (price * vatRate) / 100);

                    return {
                        iskontoArttm: "İskonto",
                        malHizmet: it.name || "Mal / Hizmet",
                        miktar: qty,
                        birim: it.unitType || "C62",
                        birimFiyat: unitPrice.toFixed(2),
                        fiyat: price.toFixed(2),
                        iskontoOrani: 0,
                        iskontoTutari: "0.00",
                        iskontoNedeni: "",
                        malHizmetTutari: (qty * unitPrice).toFixed(2),
                        kdvOrani: vatRate.toFixed(0),
                        vergiOrani: 0,
                        kdvTutari: vatAmount.toFixed(2),
                        vergininKdvTutari: "0.00",
                    };
                });

                // GİB'e gönderilecek temel veri gövdesi
                // Elle girilmiş bir not yoksa bu alan boş string olarak gönderilir
                const baseInvoiceData: Record<string, unknown> = {
                    belgeNumarasi: "",
                    faturaTarihi: date,
                    saat: time,
                    paraBirimi: currency,
                    dovzTLkur: currencyRate,
                    faturaTipi: invoiceType,
                    hangiTip: "5000/30000",
                    siparisNumarasi: "",
                    siparisTarihi: "",
                    irsaliyeNumarasi: "",
                    irsaliyeTarihi: "",
                    fisNo: "",
                    fisTarihi: "",
                    fisSaati: " ",
                    fisTipi: " ",
                    zRaporNo: "",
                    okcSeriNo: "",
                    vknTckn: taxIDOrTRID,
                    aliciUnvan: title,
                    aliciAdi: name,
                    aliciSoyadi: surname,
                    bulvarcaddesokak: fullAddress,
                    binaAdi: "",
                    binaNo: "",
                    kapiNo: "",
                    kasabaKoy: "",
                    mahalleSemtIlce: "",
                    sehir: " ",
                    ulke: country,
                    postaKodu: "",
                    tel: "",
                    fax: "",
                    eposta: "",
                    websitesi: "",
                    vergiDairesi: taxOffice,
                    komisyonOrani: 0,
                    navlunOrani: 0,
                    hammaliyeOrani: 0,
                    nakliyeOrani: 0,
                    komisyonTutari: "0",
                    navlunTutari: "0",
                    hammaliyeTutari: "0",
                    nakliyeTutari: "0",
                    komisyonKDVOrani: 0,
                    navlunKDVOrani: 0,
                    hammaliyeKDVOrani: 0,
                    nakliyeKDVOrani: 0,
                    komisyonKDVTutari: "0",
                    navlunKDVTutari: "0",
                    hammaliyeKDVTutari: "0",
                    nakliyeKDVTutari: "0",
                    gelirVergisiOrani: 0,
                    bagkurTevkifatiOrani: 0,
                    gelirVergisiTevkifatiTutari: "0",
                    bagkurTevkifatiTutari: "0",
                    halRusumuOrani: 0,
                    ticaretBorsasiOrani: 0,
                    milliSavunmaFonuOrani: 0,
                    digerOrani: 0,
                    halRusumuTutari: "0",
                    ticaretBorsasiTutari: "0",
                    milliSavunmaFonuTutari: "0",
                    digerTutari: "0",
                    halRusumuKDVOrani: 0,
                    ticaretBorsasiKDVOrani: 0,
                    milliSavunmaFonuKDVOrani: 0,
                    digerKDVOrani: 0,
                    halRusumuKDVTutari: "0",
                    ticaretBorsasiKDVTutari: "0",
                    milliSavunmaFonuKDVTutari: "0",
                    digerKDVTutari: "0",
                    iadeTable: [],
                    ozelMatrahTutari: "0",
                    ozelMatrahOrani: 0,
                    ozelMatrahVergiTutari: "0.00",
                    vergiCesidi: " ",
                    malHizmetTable,
                    tip: "İskonto",
                    matrah: grandTotal.toFixed(2),
                    malhizmetToplamTutari: grandTotal.toFixed(2),
                    toplamIskonto: "0.00",
                    hesaplanankdv: totalVAT.toFixed(2),
                    vergilerToplami: totalVAT.toFixed(2),
                    vergilerDahilToplamTutar: grandTotalInclVAT.toFixed(2),
                    toplamMasraflar: "0",
                    odenecekTutar: paymentTotal.toFixed(2),
                    not: userEnteredNote ? userEnteredNote : "",
                };

                logServer("INFO", "INVOICE", userEnteredNote ? `Fatura notu eklendi: "${userEnteredNote}"` : "Fatura notu girilmedi, 'not' alanı boş gönderiliyor.");

                let draftResult: { date: string; uuid: string; data?: unknown } | null = null;
                let lastCreateError: string = "";

                // Deneme 1: faturaUuid: "" ile oluşturma (GİB yeni standardı)
                try {
                    logServer("INFO", "GIB", `[Deneme 1] EARSIV_PORTAL_FATURA_OLUSTUR gönderiliyor (faturaUuid: "")...`);
                    const payload1 = { ...baseInvoiceData, faturaUuid: "" };
                    const resDraft1 = await client.runCommand(body.token, "EARSIV_PORTAL_FATURA_OLUSTUR", "RG_BASITFATURA", payload1);
                    const resText1 = typeof resDraft1.data === "string" ? resDraft1.data.trim() : JSON.stringify(resDraft1.data || "");
                    logServer("INFO", "GIB", `GİB Yanıtı (Deneme 1): ${resText1}`);

                    if (/başarıyla oluşturulmuştur/i.test(resText1) || !resDraft1.data) {
                        draftResult = {
                            date,
                            uuid: generatedUuid,
                            data: resDraft1.data || "Fatura başarıyla oluşturulmuştur.",
                        };
                    } else {
                        lastCreateError = resText1;
                    }
                } catch (err1: unknown) {
                    lastCreateError = err1 instanceof Error ? err1.message : String(err1);
                    logServer("WARN", "GIB", `Deneme 1 başarısız oldu: ${lastCreateError}`);
                }

                // Deneme 2 Fallback: faturaUuid & ettn = generatedUuid
                if (!draftResult) {
                    try {
                        logServer("INFO", "GIB", `[Deneme 2] EARSIV_PORTAL_FATURA_OLUSTUR gönderiliyor (faturaUuid: "${generatedUuid}")...`);
                        const payload2 = { ...baseInvoiceData, faturaUuid: generatedUuid, ettn: generatedUuid };
                        const resDraft2 = await client.runCommand(body.token, "EARSIV_PORTAL_FATURA_OLUSTUR", "RG_BASITFATURA", payload2);
                        const resText2 = typeof resDraft2.data === "string" ? resDraft2.data.trim() : JSON.stringify(resDraft2.data || "");
                        logServer("INFO", "GIB", `GİB Yanıtı (Deneme 2): ${resText2}`);

                        if (/başarıyla oluşturulmuştur/i.test(resText2)) {
                            draftResult = {
                                date,
                                uuid: generatedUuid,
                                data: resDraft2.data,
                            };
                        } else {
                            lastCreateError = resText2;
                        }
                    } catch (err2: unknown) {
                        lastCreateError = err2 instanceof Error ? err2.message : String(err2);
                        logServer("ERROR", "GIB", `Deneme 2 başarısız oldu: ${lastCreateError}`);
                    }
                }

                if (!draftResult) {
                    logServer("ERROR", "INVOICE", `Fatura oluşturulamadı: ${lastCreateError}`);
                    throw new Error(lastCreateError || "Fatura taslağı oluşturulamadı.");
                }

                logServer("INFO", "INVOICE", `Taslak başarıyla oluşturuldu! UUID: ${draftResult.uuid}`);

                let signed = false;
                let foundInvoice: InvoiceListItem | undefined;

                if (body.sign) {
                    logServer("INFO", "INVOICE", `Fatura imzalanıyor (UUID: ${draftResult.uuid})...`);
                    const allInvoices = await client.getOutgoingInvoices(body.token, draftResult.date, draftResult.date);
                    foundInvoice = allInvoices.find((invItem) => (invItem.ettn || invItem.uuid) === draftResult!.uuid);
                    if (foundInvoice) {
                        await client.signDraftInvoice(body.token, foundInvoice);
                        signed = true;
                        logServer("INFO", "INVOICE", `Fatura başarıyla imzalandı! Belge No: ${foundInvoice.belgeNumarasi || "Bilinmiyor"}`);
                    } else {
                        logServer("WARN", "INVOICE", `Taslak listede bulunamadı, doğrudan ETTN ile imzalama deneniyor...`);
                        await client.signDraftInvoice(body.token, { ettn: draftResult.uuid } as InvoiceListItem);
                        signed = true;
                    }
                }

                sendJson(res, 200, {
                    success: true,
                    draft: draftResult,
                    signed,
                    foundInvoice,
                    message: signed ? "Fatura başarıyla oluşturuldu ve imzalandı." : "Taslak fatura başarıyla oluşturuldu.",
                });
                return;
            }

            // 6. Fatura HTML Görüntüle
            if (pathname === "/api/invoices/html" && req.method === "POST") {
                const body = await readJsonBody<{
                    env?: EnvironmentKey;
                    token?: string;
                    uuid?: string;
                    signed?: boolean;
                    onayDurumu?: string;
                }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                if (!body.token || !body.uuid) {
                    sendJson(res, 400, { success: false, error: "Token ve fatura UUID (ETTN) zorunludur." });
                    return;
                }

                let onayDurumu = body.onayDurumu;
                if (!onayDurumu) {
                    onayDurumu = body.signed ? "Onaylandı" : "Onaylanmadı";
                }

                logServer("INFO", "GIB", `HTML önizleme isteniyor: UUID=${body.uuid}, Durum=${onayDurumu}`);
                const client = getGibClient(env);
                try {
                    const html = await client.getInvoiceHTML(body.token, body.uuid, onayDurumu === "Onaylandı");
                    if (html) {
                        logServer("INFO", "GIB", `HTML başarıyla alındı (${html.length} bayt).`);
                    } else {
                        logServer("WARN", "GIB", "HTML boş döndü.");
                    }
                    sendJson(res, 200, { success: true, html });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logServer("WARN", "GIB", `HTML önizleme hatası (uuid=${body.uuid}): ${msg}`);
                    sendJson(res, 400, { success: false, error: msg });
                }
                return;
            }

            // 7. Fatura İndir (.ZIP)
            if (pathname === "/api/invoices/download" && req.method === "GET") {
                const env = reqUrl.searchParams.get("env") === "TEST" ? "TEST" : "PROD";
                const token = reqUrl.searchParams.get("token") || "";
                const uuid = reqUrl.searchParams.get("uuid") || "";
                const signed = reqUrl.searchParams.get("signed") === "true";

                if (!token || !uuid) {
                    sendJson(res, 400, { success: false, error: "Token ve UUID gereklidir." });
                    return;
                }

                logServer("INFO", "GIB", `Fatura ZIP indiriliyor: UUID=${uuid}`);
                const client = getGibClient(env);
                const downloadUrl = client.getDownloadURL(token, uuid, signed);

                const downloadRes = await fetch(downloadUrl);
                if (!downloadRes.ok) {
                    logServer("ERROR", "GIB", `İndirme bağlantısı başarısız oldu: HTTP ${downloadRes.status}`);
                    sendJson(res, downloadRes.status, { success: false, error: "GİB indirme bağlantısı başarısız oldu." });
                    return;
                }

                const arrayBuffer = await downloadRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                logServer("INFO", "GIB", `ZIP dosyası başarıyla iletildi (${buffer.length} bayt).`);

                res.writeHead(200, {
                    "Content-Type": "application/zip",
                    "Content-Disposition": `attachment; filename="fatura-${uuid}.zip"`,
                    "Content-Length": buffer.length,
                });
                res.end(buffer);
                return;
            }

            // 7.1 PDF Durum Kontrolü (Tarayıcı Hazır mı?)
            if (pathname === "/api/pdf/status" && req.method === "GET") {
                const browserPath = await findBrowserExecutable();
                sendJson(res, 200, {
                    success: true,
                    available: Boolean(browserPath),
                    browserPath,
                });
                return;
            }

            // 7.2 Fatura Doğrudan PDF İndir (GET)
            if (pathname === "/api/invoices/pdf" && req.method === "GET") {
                const env = reqUrl.searchParams.get("env") === "TEST" ? "TEST" : "PROD";
                const token = reqUrl.searchParams.get("token") || "";
                const uuid = reqUrl.searchParams.get("uuid") || "";
                const signed = reqUrl.searchParams.get("signed") === "true";
                const onayDurumu = reqUrl.searchParams.get("onayDurumu") || (signed ? "Onaylandı" : "Onaylanmadı");
                const belgeNo = reqUrl.searchParams.get("belgeNo") || uuid;

                if (!token || !uuid) {
                    sendJson(res, 400, { success: false, error: "Token ve UUID gereklidir." });
                    return;
                }

                logServer("INFO", "GIB", `Fatura doğrudan PDF isteniyor: UUID=${uuid}, Durum=${onayDurumu}`);
                const cacheKey = `${env}:${uuid}:${onayDurumu}`;
                const cached = getCachedPdf(cacheKey);
                if (cached) {
                    logServer("INFO", "SYSTEM", `PDF önbellekten getirildi (Cache Hit: ${uuid}, ${cached.length} bayt).`);
                    const safeFilename = encodeURIComponent(`fatura-${belgeNo}.pdf`);
                    res.writeHead(200, {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
                        "Content-Length": cached.length,
                    });
                    res.end(cached);
                    return;
                }

                const client = getGibClient(env);
                try {
                    const html = await client.getInvoiceHTML(token, uuid, onayDurumu === "Onaylandı");
                    if (!html) {
                        sendJson(res, 404, { success: false, error: "GİB'den fatura HTML verisi alınamadı." });
                        return;
                    }

                    logServer("INFO", "SYSTEM", `Fatura HTML'den PDF'e dönüştürülüyor: ${uuid}`);
                    const pdfBuffer = await convertHtmlToPdf(html);
                    setCachedPdf(cacheKey, pdfBuffer);
                    logServer("INFO", "SYSTEM", `PDF başarıyla oluşturuldu (${pdfBuffer.length} bayt).`);

                    const safeFilename = encodeURIComponent(`fatura-${belgeNo}.pdf`);
                    res.writeHead(200, {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
                        "Content-Length": pdfBuffer.length,
                    });
                    res.end(pdfBuffer);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logServer("ERROR", "SYSTEM", `PDF oluşturma hatası (uuid=${uuid}): ${msg}`);
                    sendJson(res, 500, { success: false, error: `PDF oluşturulamadı: ${msg}` });
                }
                return;
            }

            // 7.3 Fatura Doğrudan PDF İndir (POST)
            if (pathname === "/api/invoices/pdf" && req.method === "POST") {
                const body = await readJsonBody<{
                    env?: EnvironmentKey;
                    token?: string;
                    uuid?: string;
                    signed?: boolean;
                    onayDurumu?: string;
                    belgeNo?: string;
                }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";

                if (!body.token || !body.uuid) {
                    sendJson(res, 400, { success: false, error: "Token ve UUID gereklidir." });
                    return;
                }

                const onayDurumu = body.onayDurumu || (body.signed ? "Onaylandı" : "Onaylanmadı");
                const belgeNo = body.belgeNo || body.uuid;

                logServer("INFO", "GIB", `Fatura doğrudan PDF isteniyor (POST): UUID=${body.uuid}, Durum=${onayDurumu}`);
                const cacheKey = `${env}:${body.uuid}:${onayDurumu}`;
                const cached = getCachedPdf(cacheKey);
                if (cached) {
                    logServer("INFO", "SYSTEM", `PDF önbellekten getirildi (Cache Hit: ${body.uuid}, ${cached.length} bayt).`);
                    const safeFilename = encodeURIComponent(`fatura-${belgeNo}.pdf`);
                    res.writeHead(200, {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
                        "Content-Length": cached.length,
                    });
                    res.end(cached);
                    return;
                }

                const client = getGibClient(env);
                try {
                    const html = await client.getInvoiceHTML(body.token, body.uuid, onayDurumu === "Onaylandı");
                    if (!html) {
                        sendJson(res, 404, { success: false, error: "GİB'den fatura HTML verisi alınamadı." });
                        return;
                    }

                    logServer("INFO", "SYSTEM", `Fatura HTML'den PDF'e dönüştürülüyor: ${body.uuid}`);
                    const pdfBuffer = await convertHtmlToPdf(html);
                    setCachedPdf(cacheKey, pdfBuffer);
                    logServer("INFO", "SYSTEM", `PDF başarıyla oluşturuldu (${pdfBuffer.length} bayt).`);

                    const safeFilename = encodeURIComponent(`fatura-${belgeNo}.pdf`);
                    res.writeHead(200, {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
                        "Content-Length": pdfBuffer.length,
                    });
                    res.end(pdfBuffer);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logServer("ERROR", "SYSTEM", `PDF oluşturma hatası (uuid=${body.uuid}): ${msg}`);
                    sendJson(res, 500, { success: false, error: `PDF oluşturulamadı: ${msg}` });
                }
                return;
            }

            // 7.4 Herhangi Bir HTML'i PDF'e Dönüştür (POST)
            if (pathname === "/api/pdf/convert" && req.method === "POST") {
                const body = await readJsonBody<{
                    html?: string;
                    filename?: string;
                }>(req);

                if (!body.html) {
                    sendJson(res, 400, { success: false, error: "Dönüştürülecek HTML içeriği gereklidir." });
                    return;
                }

                try {
                    logServer("INFO", "SYSTEM", `HTML metninden doğrudan PDF oluşturuluyor (${body.html.length} karakter)...`);
                    const pdfBuffer = await convertHtmlToPdf(body.html);
                    const filename = encodeURIComponent(body.filename || "belge.pdf");

                    res.writeHead(200, {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
                        "Content-Length": pdfBuffer.length,
                    });
                    res.end(pdfBuffer);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logServer("ERROR", "SYSTEM", `HTML->PDF dönüştürme hatası: ${msg}`);
                    sendJson(res, 500, { success: false, error: `PDF oluşturulamadı: ${msg}` });
                }
                return;
            }

            // 8. Taslak Faturayı İmzala
            if (pathname === "/api/invoices/sign" && req.method === "POST") {
                const body = await readJsonBody<{
                    env?: EnvironmentKey;
                    token?: string;
                    uuid?: string;
                    draftInvoice?: InvoiceListItem;
                }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                const draftInv = body.draftInvoice || (body.uuid ? ({ ettn: body.uuid } as InvoiceListItem) : undefined);
                if (!body.token || !draftInv) {
                    sendJson(res, 400, { success: false, error: "Token ve fatura bilgisi (veya UUID) zorunludur." });
                    return;
                }

                logServer("INFO", "INVOICE", `Taslak imzalanıyor: ${draftInv.ettn} (${env})`);
                const client = getGibClient(env);
                const result = await client.signDraftInvoice(body.token, draftInv);
                logServer("INFO", "INVOICE", `İmzalama tamamlandı.`);
                sendJson(res, 200, { success: true, result });
                return;
            }

            // 9. Taslak Faturayı İptal Et
            if (pathname === "/api/invoices/cancel" && req.method === "POST") {
                const body = await readJsonBody<{
                    env?: EnvironmentKey;
                    token?: string;
                    reason?: string;
                    uuid?: string;
                    draftInvoice?: InvoiceListItem;
                }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                const draftInv = body.draftInvoice || (body.uuid ? ({ ettn: body.uuid } as InvoiceListItem) : undefined);
                if (!body.token || !body.reason || !draftInv) {
                    sendJson(res, 400, { success: false, error: "Token, iptal gerekçesi ve fatura bilgisi zorunludur." });
                    return;
                }

                logServer("INFO", "INVOICE", `Taslak iptal ediliyor: ${draftInv.ettn}, Gerekçe: ${body.reason}`);
                const client = getGibClient(env);
                const result = await client.cancelDraftInvoice(body.token, body.reason, draftInv);
                logServer("INFO", "INVOICE", `Taslak iptal edildi.`);
                sendJson(res, 200, { success: true, result });
                return;
            }

            // 10. Kullanıcı Profil Bilgisi
            if (pathname === "/api/user-data" && req.method === "POST") {
                const body = await readJsonBody<{ env?: EnvironmentKey; token?: string; userCode?: string }>(req);
                const env = body.env === "TEST" ? "TEST" : "PROD";
                if (!body.token) {
                    sendJson(res, 400, { success: false, error: "Token zorunludur." });
                    return;
                }

                logServer("INFO", "GIB", `Mükellef profil bilgileri çekiliyor (${env})...`);
                try {
                    const client = getGibClient(env);
                    const data = await client.getUserData(body.token);

                    // Girişte kullanılan kullanıcı kodunu ekle
                    const loginUserCode = tokenUserCodeMap.get(body.token) || body.userCode;
                    if (loginUserCode) {
                        data.userCode = loginUserCode;
                        if (!tokenUserCodeMap.has(body.token)) {
                            tokenUserCodeMap.set(body.token, loginUserCode);
                        }
                    }

                    logServer("INFO", "GIB", `Mükellef verisi başarıyla alındı: ${data.name || data.title || data.taxIDOrTRID} (Kullanıcı Kodu: ${data.userCode || "-"})`);
                    sendJson(res, 200, { success: true, data });
                } catch (err: unknown) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    logServer("ERROR", "GIB", `Mükellef verisi alınamadı: ${errorMsg}`);
                    sendJson(res, 500, { success: false, error: errorMsg });
                }
                return;
            }

            // Bulunamayan API rotası
            logServer("WARN", "HTTP", `404 API bulunamadı: ${pathname}`);
            sendJson(res, 404, { success: false, error: "Bilinmeyen API ucu" });
            return;
        }

        // --- STATİK DOSYALAR (HTML, JS, CSS) ---
        serveStatic(req, res, pathname);
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logServer("ERROR", "HTTP", `Sunucu Hatası (${pathname}): ${errorMsg}`);
        sendJson(res, 500, { success: false, error: errorMsg });
    }
});

server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🧾 e-Arşiv Fatura Arayüzü Başlatıldı!`);
    console.log(`🌐 Adres: http://localhost:${PORT}`);
    console.log(`===============================================`);
});
