import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedBrowserPath: string | null | undefined = undefined;

/**
 * Sistemde yüklü olan Chromium tabanlı tarayıcı (Edge, Chrome, Brave, Chromium) çalıştırılabilir dosyasını bulur.
 */
export async function findBrowserExecutable(): Promise<string | null> {
    if (cachedBrowserPath !== undefined) {
        return cachedBrowserPath;
    }

    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const isLinux = process.platform === "linux";

    const candidatePaths: string[] = [];

    if (isWindows) {
        const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
        const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        const localAppData = process.env["LOCALAPPDATA"] || "";

        candidatePaths.push(
            path.join(programFilesX86, "Microsoft\\Edge\\Application\\msedge.exe"),
            path.join(programFiles, "Microsoft\\Edge\\Application\\msedge.exe"),
            path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
            path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe"),
            path.join(programFiles, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
            path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
            path.join(localAppData, "Microsoft\\Edge\\Application\\msedge.exe")
        );
    } else if (isMac) {
        candidatePaths.push(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Chromium.app/Contents/MacOS/Chromium"
        );
    } else if (isLinux) {
        candidatePaths.push(
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge-stable",
            "/usr/bin/microsoft-edge",
            "/snap/bin/chromium"
        );
    }

    for (const p of candidatePaths) {
        try {
            await fs.access(p);
            cachedBrowserPath = p;
            return p;
        } catch {
            // Dosya mevcut değil, sonraki adaya geç
        }
    }

    cachedBrowserPath = null;
    return null;
}

/**
 * GİB faturasının HTML kodunu A4 PDF çıktısı için optimize eder
 */
export function prepareInvoiceHtmlForPdf(rawHtml: string): string {
    // Sayfa stili ve yazdırma optimizasyonu için CSS ekle
    const printStyles = `
    <style id="better-earsiv-pdf-print-style">
        @page {
            size: A4 portrait;
            margin: 8mm 6mm 8mm 6mm;
        }
        @media print {
            body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                background-color: #ffffff !important;
                color: #000000 !important;
                font-family: Arial, "Helvetica Neue", Helvetica, sans-serif !important;
            }
            table {
                page-break-inside: avoid;
            }
            .no-print {
                display: none !important;
            }
        }
        html, body {
            margin: 0;
            padding: 0;
            background: #fff;
        }
    </style>
    `;

    // Eğer HTML dokümanında </head> varsa önüne, yoksa en başa ekle
    if (rawHtml.includes("</head>")) {
        return rawHtml.replace("</head>", `${printStyles}</head>`);
    } else if (rawHtml.includes("<body")) {
        return rawHtml.replace(/<body([^>]*)>/i, `<body$1>${printStyles}`);
    } else {
        return `<!DOCTYPE html><html><head><meta charset="utf-8">${printStyles}</head><body>${rawHtml}</body></html>`;
    }
}

/**
 * Verilen HTML dizesini doğrudan PDF formatına çevirir ve Buffer döndürür.
 */
export async function convertHtmlToPdf(html: string): Promise<Buffer> {
    const browserPath = await findBrowserExecutable();
    if (!browserPath) {
        throw new Error(
            "PDF dönüştürme için sistemde uyumlu bir tarayıcı (Edge, Chrome veya Chromium) bulunamadı. Lütfen sisteminizde Edge veya Chrome yüklü olduğundan emin olun."
        );
    }

    const preparedHtml = prepareInvoiceHtmlForPdf(html);
    const tempDir = os.tmpdir();
    const uniqueId = crypto.randomUUID();
    const tempHtmlPath = path.join(tempDir, `fatura_${uniqueId}.html`);
    const tempPdfPath = path.join(tempDir, `fatura_${uniqueId}.pdf`);

    try {
        // Geçici HTML dosyasını UTF-8 olarak kaydet
        await fs.writeFile(tempHtmlPath, preparedHtml, "utf-8");

        // Headless tarayıcı parametreleri
        const args = [
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--no-pdf-header-footer",
            "--run-all-compositor-stages-before-draw",
            `--print-to-pdf=${tempPdfPath}`,
            tempHtmlPath,
        ];

        // Tarayıcıyı çalıştır
        await execFileAsync(browserPath, args, { timeout: 30000 });

        // PDF dosyasını oku
        const pdfBuffer = await fs.readFile(tempPdfPath);
        return pdfBuffer;
    } finally {
        // Geçici dosyaları temizle
        await fs.unlink(tempHtmlPath).catch(() => {});
        await fs.unlink(tempPdfPath).catch(() => {});
    }
}
