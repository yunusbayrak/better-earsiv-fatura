// e-Arşiv Fatura Arayüzü TypeScript İstemci Mantığı (Sunucusuz / 100% Client-Side)
import { generateGibInvoiceHtml } from "./gibTemplate.js";
import { GibClient, EnvironmentKey, InvoiceListItem, UserProfileData, LogLevel, LogCategory } from "./gibClient.js";

declare const bootstrap: {
    Modal: {
        new (element: HTMLElement | null): { show(): void; hide(): void };
        getInstance(element: HTMLElement | null): { show(): void; hide(): void } | null;
    };
    Toast: {
        new (element: HTMLElement | null): { show(): void };
    };
};

function getGibClient(env: EnvironmentKey = state.env): GibClient {
    return new GibClient(env, logApp);
}

function prepareInvoiceHtmlForPdf(rawHtml: string): string {
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
            background-color: #ffffff;
        }
    </style>
    `;
    if (rawHtml.includes("</head>")) {
        return rawHtml.replace("</head>", `${printStyles}\n</head>`);
    }
    return `${printStyles}\n${rawHtml}`;
}

async function generatePdfFromHtml(rawHtml: string, filename: string): Promise<void> {
    const styledHtml = prepareInvoiceHtmlForPdf(rawHtml);

    // 1. html2pdf kütüphanesi mevcutsa (CDN)
    const globalHtml2Pdf = (window as unknown as { html2pdf?: unknown }).html2pdf;
    if (typeof globalHtml2Pdf === "function") {
        const tempDiv = document.createElement("div");
        tempDiv.style.position = "fixed";
        tempDiv.style.left = "-9999px";
        tempDiv.style.top = "0";
        tempDiv.style.width = "210mm";
        tempDiv.style.backgroundColor = "#ffffff";
        tempDiv.innerHTML = styledHtml;
        document.body.appendChild(tempDiv);

        try {
            const opt = {
                margin: [8, 6, 8, 6],
                filename,
                image: { type: "jpeg", quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false },
                jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
            };
            // @ts-ignore
            await globalHtml2Pdf().set(opt).from(tempDiv).save();
            return;
        } finally {
            tempDiv.remove();
        }
    }

    // 2. Yedek: Tarayıcının yerel yazdırma penceresini aç
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    printFrame.srcdoc = styledHtml;
    printFrame.onload = () => {
        setTimeout(() => {
            try {
                printFrame.contentWindow?.focus();
                printFrame.contentWindow?.print();
            } finally {
                setTimeout(() => printFrame.remove(), 1000);
            }
        }, 300);
    };
}

interface InvoiceItemState {
    id: string;
    name: string;
    quantity: number;
    unitType: string;
    unitPrice: number;
    vatRate: number;
    vatAmount: number;
    price: number;
    total: number;
}

interface AppState {
    token: string | null;
    env: "TEST" | "PROD";
    username: string | null;
    userCode: string | null;
    items: InvoiceItemState[];
    invoices: Array<Record<string, unknown>>;
    selectedDraftForCancel: Record<string, unknown> | null;
    currentPreviewUuid: string | null;
    currentPreviewSigned: boolean;
    currentPreviewHtml: string | null;
    currentPreviewBelgeNo: string | null;
    currentJsonModalData: unknown | null;
    currentDraftDetailItem: Record<string, unknown> | null;
    invoiceStatusFilter: "all" | "signed" | "draft" | "deleted";
    userData: Record<string, unknown> | null;
}

const state: AppState = {
    token: sessionStorage.getItem("gib_token") || null,
    env: (sessionStorage.getItem("gib_env") as "TEST" | "PROD") || "TEST",
    username: sessionStorage.getItem("gib_username") || null,
    userCode: sessionStorage.getItem("gib_user_code") || localStorage.getItem("gib_user_code") || null,
    items: [],
    invoices: [],
    selectedDraftForCancel: null,
    currentPreviewUuid: null,
    currentPreviewSigned: false,
    currentPreviewHtml: null,
    currentPreviewBelgeNo: null,
    currentJsonModalData: null,
    currentDraftDetailItem: null,
    invoiceStatusFilter: "all",
    userData: null,
};

// Sayıdan Para Birimi Metnine Çevirici (Örn: BeşBinYüz ABD Doları / Bin Türk Lirası)
function numberToTurkishText(amount: number, currency?: string): string {
    const curr = currency || getCurrentCurrency();
    const currencyUnits: Record<string, { main: string; sub: string }> = {
        TRY: { main: "Türk Lirası", sub: "Kuruş" },
        USD: { main: "ABD Doları", sub: "Sent" },
        EUR: { main: "Avro", sub: "Sent" },
        GBP: { main: "İngiliz Sterlini", sub: "Peni" },
    };

    const unitInfo = currencyUnits[curr] || { main: curr, sub: "Kuruş" };

    const units = ["", "Bir", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi", "Sekiz", "Dokuz"];
    const tens = ["", "On", "Yirmi", "Otuz", "Kırk", "Elli", "Altmış", "Yetmiş", "Seksen", "Doksan"];

    function convertGroup(num: number): string {
        let text = "";
        const c = Math.floor(num / 100);
        const t = Math.floor((num % 100) / 10);
        const u = num % 10;

        if (c > 0) {
            if (c === 1) text += "Yüz";
            else text += units[c] + "Yüz";
        }
        if (t > 0) text += tens[t];
        if (u > 0) text += units[u];
        return text;
    }

    const mainPart = Math.floor(amount);
    const subPart = Math.round((amount - mainPart) * 100);

    let mainText = "";
    if (mainPart === 0) {
        mainText = "Sıfır";
    } else {
        const millions = Math.floor(mainPart / 1000000);
        const thousands = Math.floor((mainPart % 1000000) / 1000);
        const remainder = mainPart % 1000;

        if (millions > 0) mainText += convertGroup(millions) + "Milyon";
        if (thousands > 0) {
            if (thousands === 1) mainText += "Bin";
            else mainText += convertGroup(thousands) + "Bin";
        }
        if (remainder > 0) mainText += convertGroup(remainder);
    }

    let subText = "";
    if (subPart > 0) {
        subText = convertGroup(subPart) + " " + unitInfo.sub;
    }

    return `${mainText} ${unitInfo.main}${subText ? " " + subText : ""}`.trim();
}

// Para formatı (1.234,56 TL / USD)
function getCurrentCurrency(): string {
    const currEl = document.getElementById("currency") as HTMLSelectElement | null;
    return currEl?.value || "TRY";
}

function getCurrencySymbol(curr?: string): string {
    const c = curr || getCurrentCurrency();
    const symbols: Record<string, string> = { TRY: "₺", USD: "$", EUR: "€", GBP: "£" };
    return symbols[c] || c;
}

function formatMoney(amount: number, currency?: string): string {
    const curr = currency || getCurrentCurrency();
    const symbols: Record<string, string> = { TRY: "TL", USD: "USD ($)", EUR: "EUR (€)", GBP: "GBP (£)" };
    const label = symbols[curr] || curr;
    return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " " + label;
}

// Toast Bildirimi Göster
function showToast(message: string, type: "success" | "danger" | "warning" | "info" = "info"): void {
    const toastEl = document.getElementById("liveToast");
    const toastBody = document.getElementById("toastMessage");
    if (!toastEl || !toastBody) return;

    const icons: Record<string, string> = {
        success: `<i class="bi bi-check-circle-fill text-white fs-5"></i>`,
        danger: `<i class="bi bi-exclamation-triangle-fill text-white fs-5"></i>`,
        warning: `<i class="bi bi-exclamation-circle-fill text-white fs-5"></i>`,
        info: `<i class="bi bi-info-circle-fill text-white fs-5"></i>`,
    };

    toastEl.className = `toast align-items-center text-white border-0 bg-${type} toast-custom`;
    toastBody.innerHTML = `
        <div class="d-flex align-items-center gap-2">
            ${icons[type] || icons.info}
            <div class="fw-medium small">${message}</div>
        </div>
    `;
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}

// Hızlı Tarih Butonu Vurgulayıcı
function setQuickDateActiveButton(activeBtnId: string | null): void {
    const group = document.getElementById("quickDateGroup");
    if (!group) return;
    const buttons = group.querySelectorAll("button");
    buttons.forEach((btn) => {
        if (activeBtnId && btn.id === activeBtnId) {
            btn.classList.add("active", "btn-primary");
            btn.classList.remove("btn-outline-secondary");
        } else {
            btn.classList.remove("active", "btn-primary");
            btn.classList.add("btn-outline-secondary");
        }
    });
}

// Tarih ve saat ilklendirme (Bugün ve Son 7 gün filtresi)
function initDateFields(forceReset = false): void {
    const dateInput = document.getElementById("invoiceDate") as HTMLInputElement;
    const timeInput = document.getElementById("invoiceTime") as HTMLInputElement;
    const filterStart = document.getElementById("filterStartDate") as HTMLInputElement;
    const filterEnd = document.getElementById("filterEndDate") as HTMLInputElement;

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Son 7 gün (Bugün dahil 7 günlük pencere)
    const past7 = new Date(now);
    past7.setDate(past7.getDate() - 6);
    const startStr = `${past7.getFullYear()}-${pad(past7.getMonth() + 1)}-${pad(past7.getDate())}`;

    if (dateInput && (!dateInput.value || forceReset)) dateInput.value = dateStr;
    if (timeInput && (!timeInput.value || forceReset)) timeInput.value = timeStr;
    if (filterStart && (!filterStart.value || forceReset)) filterStart.value = startStr;
    if (filterEnd && (!filterEnd.value || forceReset)) filterEnd.value = dateStr;

    syncDateInputsConstraint();
    setQuickDateActiveButton("btnQuickDate7Days");
}

// Tarih Seçim Kısıtlaması & Başlangıca Göre Bitiş Tarihini Otomatik Ayarlama (Maksimum 7 Gün)
function syncDateInputsConstraint(changedField?: "start" | "end"): void {
    const startInput = document.getElementById("filterStartDate") as HTMLInputElement | null;
    const endInput = document.getElementById("filterEndDate") as HTMLInputElement | null;
    if (!startInput || !endInput) return;

    const pad = (n: number) => n.toString().padStart(2, "0");
    const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (changedField === "start" && startInput.value) {
        // Kullanıcı başlangıç tarihini seçtiğinde:
        const [sy, sm, sd] = startInput.value.split("-").map(Number);
        const sDate = new Date(sy, sm - 1, sd);
        const maxEndDate = new Date(sDate);
        maxEndDate.setDate(maxEndDate.getDate() + 6); // Başlangıç dahil 7 takvim günü

        const maxEndStr = formatDate(maxEndDate);
        endInput.min = startInput.value;
        endInput.max = maxEndStr;

        // Bitiş tarihi boşsa, başlangıçtan önceyse veya 7 günü aşıyorsa otomatik olarak maxEndDate seç
        if (!endInput.value || endInput.value < startInput.value || endInput.value > maxEndStr) {
            endInput.value = maxEndStr;
        }
    } else if (changedField === "end" && endInput.value) {
        // Kullanıcı bitiş tarihini seçtiğinde:
        const [ey, em, ed] = endInput.value.split("-").map(Number);
        const eDate = new Date(ey, em - 1, ed);
        const minStartDate = new Date(eDate);
        minStartDate.setDate(minStartDate.getDate() - 6); // Bitiş dahil 7 gün öncesi

        const minStartStr = formatDate(minStartDate);
        startInput.min = minStartStr;
        startInput.max = endInput.value;

        // Başlangıç tarihi boşsa, bitişten sonraysa veya 7 günden eskiyse otomatik olarak minStartDate seç
        if (!startInput.value || startInput.value > endInput.value || startInput.value < minStartStr) {
            startInput.value = minStartStr;
        }
    } else if (startInput.value && endInput.value) {
        // İlk yükleme veya doğrudan senkronizasyon
        const [sy, sm, sd] = startInput.value.split("-").map(Number);
        const sDate = new Date(sy, sm - 1, sd);
        const maxEndDate = new Date(sDate);
        maxEndDate.setDate(maxEndDate.getDate() + 6);
        endInput.min = startInput.value;
        endInput.max = formatDate(maxEndDate);
        startInput.max = endInput.value;
    }
}

// Hızlı Tarih Filtresi Uygula (En Fazla 7 Günlük Aralıklar)
function applyQuickDateFilter(type: "today" | "yesterday" | 3 | 7, activeBtnId: string): void {
    const startInput = document.getElementById("filterStartDate") as HTMLInputElement;
    const endInput = document.getElementById("filterEndDate") as HTMLInputElement;
    if (!startInput || !endInput) return;

    const pad = (n: number) => n.toString().padStart(2, "0");
    const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const now = new Date();
    let startDateStr = "";
    let endDateStr = formatDate(now);

    if (type === "today") {
        startDateStr = formatDate(now);
        endDateStr = formatDate(now);
    } else if (type === "yesterday") {
        const yest = new Date();
        yest.setDate(yest.getDate() - 1);
        startDateStr = formatDate(yest);
        endDateStr = formatDate(yest);
    } else if (type === 3) {
        const past3 = new Date();
        past3.setDate(past3.getDate() - 2);
        startDateStr = formatDate(past3);
        endDateStr = formatDate(now);
    } else if (type === 7) {
        const past7 = new Date();
        past7.setDate(past7.getDate() - 6);
        startDateStr = formatDate(past7);
        endDateStr = formatDate(now);
    }

    startInput.value = startDateStr;
    endInput.value = endDateStr;

    syncDateInputsConstraint();
    setQuickDateActiveButton(activeBtnId);
    handleListInvoices();
}

// Oturum Durumunu Güncelle (Navbar ve Kartlar)
function updateSessionUI(): void {
    const envIndicator = document.getElementById("envIndicator");
    const sessionContainer = document.getElementById("sessionStatusContainer");
    const notLoggedInAlert = document.getElementById("notLoggedInAlert");
    const prodBanner = document.getElementById("prodWarningBanner");

    if (envIndicator) {
        if (state.env === "PROD") {
            envIndicator.className = "badge env-badge-prod px-2 py-1";
            envIndicator.textContent = "🚀 PROD (Canlı Portal)";
            if (prodBanner) prodBanner.classList.remove("d-none");
        } else {
            envIndicator.className = "badge env-badge-test px-2 py-1";
            envIndicator.textContent = "🧪 TEST (Test Portalı)";
            if (prodBanner) prodBanner.classList.add("d-none");
        }
    }

    if (sessionContainer) {
        if (state.token) {
            const code = state.userCode || sessionStorage.getItem("gib_user_code") || localStorage.getItem("gib_user_code");
            const displayName = state.username || code || "Kullanıcı";
            const showUserCodeBadge = Boolean(code && displayName && displayName !== code);
            sessionContainer.innerHTML = `
                <span class="text-light small me-2">
                    <i class="bi bi-person-circle me-1"></i>${displayName}
                    ${showUserCodeBadge ? `<span class="badge bg-light bg-opacity-25 text-white font-monospace ms-1" title="Kullanıcı Kodu">Kod: ${code}</span>` : ""}
                </span>
                <span class="badge bg-success me-2 d-inline-flex align-items-center gap-1">
                    <span class="live-dot"></span> Oturum Açık
                </span>
                <button class="btn btn-outline-danger btn-sm" id="btnLogout">
                    <i class="bi bi-box-arrow-right"></i> Çıkış
                </button>
            `;
            const btnLogout = document.getElementById("btnLogout");
            if (btnLogout) {
                btnLogout.addEventListener("click", handleLogout);
            }
            if (notLoggedInAlert) notLoggedInAlert.classList.add("d-none");
        } else {
            sessionContainer.innerHTML = `
                <button class="btn btn-outline-light btn-sm px-3" data-bs-toggle="modal" data-bs-target="#loginModal">
                    <i class="bi bi-box-arrow-in-right me-1"></i> GİB Girişi Yap
                </button>
            `;
            if (notLoggedInAlert) notLoggedInAlert.classList.remove("d-none");
        }
    }
}

// Satır Ekle
function addItem(initialData?: Partial<InvoiceItemState>): void {
    const newItem: InvoiceItemState = {
        id: Math.random().toString(36).substring(2, 9),
        name: initialData?.name || "",
        quantity: initialData?.quantity ?? 1,
        unitType: initialData?.unitType || "C62", // C62 = Adet
        unitPrice: initialData?.unitPrice ?? 0,
        vatRate: initialData?.vatRate ?? 20,
        price: 0,
        vatAmount: 0,
        total: 0,
    };
    calculateItem(newItem);
    state.items.push(newItem);
    renderItems();
    updateSummary();
}

// Satır Hesapla
function calculateItem(item: InvoiceItemState): void {
    item.price = item.quantity * item.unitPrice;
    item.vatAmount = item.price * (item.vatRate / 100);
    item.total = item.price + item.vatAmount;
}

// Satır Sil
function deleteItem(id: string): void {
    state.items = state.items.filter((i) => i.id !== id);
    renderItems();
    updateSummary();
}

// Satır Güncelle
function updateItem(id: string, field: keyof InvoiceItemState, value: string | number): void {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;

    if (field === "name" || field === "unitType") {
        item[field] = value as string;
    } else if (field === "quantity" || field === "unitPrice" || field === "vatRate") {
        item[field] = Number(value) || 0;
    }

    calculateItem(item);

    // Satır toplamı ve KDV metnini canlı güncelle
    const totalEl = document.getElementById(`item-total-${id}`);
    if (totalEl) {
        totalEl.textContent = formatMoney(item.total);
    }
    updateSummary();
}

// Kalemleri Tabloya Çiz
function renderItems(): void {
    const tbody = document.getElementById("itemsTableBody");
    if (!tbody) return;

    const currSymbol = getCurrencySymbol();

    tbody.innerHTML = "";

    if (state.items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-4 d-block mb-1 text-secondary"></i>
                    Henüz mal veya hizmet kalemi eklenmedi.
                    <div class="mt-2">
                        <button type="button" class="btn btn-outline-primary btn-sm" id="btnEmptyAddRow">
                            <i class="bi bi-plus-circle me-1"></i> Kalem Ekle
                        </button>
                    </div>
                </td>
            </tr>
        `;
        const btnEmptyAddRow = document.getElementById("btnEmptyAddRow");
        if (btnEmptyAddRow) {
            btnEmptyAddRow.addEventListener("click", () => addItem());
        }
        return;
    }

    state.items.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.id = `row-${item.id}`;
        tr.innerHTML = `
            <td>
                <input type="text" class="form-control form-control-sm item-name" data-id="${item.id}" value="${item.name}" placeholder="Ürün veya Hizmet Tanımı" required>
            </td>
            <td>
                <input type="number" step="any" min="0" class="form-control form-control-sm item-qty" data-id="${item.id}" value="${item.quantity}" required>
            </td>
            <td>
                <select class="form-select form-select-sm item-unit" data-id="${item.id}">
                    <option value="C62" ${item.unitType === "C62" ? "selected" : ""}>Adet</option>
                    <option value="HUR" ${item.unitType === "HUR" ? "selected" : ""}>Saat</option>
                    <option value="DAY" ${item.unitType === "DAY" ? "selected" : ""}>Gün</option>
                    <option value="MON" ${item.unitType === "MON" ? "selected" : ""}>Ay</option>
                    <option value="KGM" ${item.unitType === "KGM" ? "selected" : ""}>Kilogram</option>
                    <option value="MTR" ${item.unitType === "MTR" ? "selected" : ""}>Metre</option>
                    <option value="PA" ${item.unitType === "PA" ? "selected" : ""}>Paket</option>
                </select>
            </td>
            <td>
                <div class="input-group input-group-sm">
                    <input type="number" step="0.01" min="0" class="form-control item-price" data-id="${item.id}" value="${item.unitPrice}" required>
                    <span class="input-group-text">${currSymbol}</span>
                </div>
            </td>
            <td>
                <select class="form-select form-select-sm item-vat" data-id="${item.id}">
                    <option value="20" ${item.vatRate === 20 ? "selected" : ""}>%20</option>
                    <option value="10" ${item.vatRate === 10 ? "selected" : ""}>%10</option>
                    <option value="1" ${item.vatRate === 1 ? "selected" : ""}>%1</option>
                    <option value="0" ${item.vatRate === 0 ? "selected" : ""}>%0</option>
                </select>
            </td>
            <td class="text-end fw-semibold" id="item-total-${item.id}">
                ${formatMoney(item.total)}
            </td>
            <td class="text-center">
                <button type="button" class="btn btn-outline-danger btn-sm p-1 text-danger border-0 btn-delete-item" data-id="${item.id}" title="Satırı Sil">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Olay dinleyicilerini bağla
    tbody.querySelectorAll(".item-name").forEach((el) => {
        el.addEventListener("input", (e) => updateItem((e.target as HTMLElement).dataset.id!, "name", (e.target as HTMLInputElement).value));
    });
    tbody.querySelectorAll(".item-qty").forEach((el) => {
        el.addEventListener("input", (e) => updateItem((e.target as HTMLElement).dataset.id!, "quantity", (e.target as HTMLInputElement).value));
    });
    tbody.querySelectorAll(".item-unit").forEach((el) => {
        el.addEventListener("change", (e) => updateItem((e.target as HTMLElement).dataset.id!, "unitType", (e.target as HTMLSelectElement).value));
    });
    tbody.querySelectorAll(".item-price").forEach((el) => {
        el.addEventListener("input", (e) => updateItem((e.target as HTMLElement).dataset.id!, "unitPrice", (e.target as HTMLInputElement).value));
    });
    tbody.querySelectorAll(".item-vat").forEach((el) => {
        el.addEventListener("change", (e) => updateItem((e.target as HTMLElement).dataset.id!, "vatRate", (e.target as HTMLSelectElement).value));
    });
    tbody.querySelectorAll(".btn-delete-item").forEach((el) => {
        el.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-delete-item") as HTMLElement;
            if (btn && btn.dataset.id) deleteItem(btn.dataset.id);
        });
    });
}

// Genel Toplamları ve Özeti Güncelle
function updateSummary(): void {
    let subtotal = 0;
    let totalVat = 0;
    let grandTotal = 0;

    state.items.forEach((item) => {
        subtotal += item.price;
        totalVat += item.vatAmount;
        grandTotal += item.total;
    });

    const curr = getCurrentCurrency();
    const currSymbol = getCurrencySymbol(curr);

    const subtotalEl = document.getElementById("summarySubtotal");
    const vatEl = document.getElementById("summaryTotalVat");
    const grandTotalEl = document.getElementById("summaryGrandTotal");
    const priceTextEl = document.getElementById("summaryPriceText");
    const currencyBadgeEl = document.getElementById("summaryCurrencyBadge");

    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal, curr);
    if (vatEl) vatEl.textContent = formatMoney(totalVat, curr);
    if (grandTotalEl) grandTotalEl.textContent = formatMoney(grandTotal, curr);
    if (priceTextEl) priceTextEl.textContent = grandTotal > 0 ? numberToTurkishText(grandTotal, curr) : "-";
    if (currencyBadgeEl) currencyBadgeEl.textContent = `${curr} (${currSymbol})`;
}

export interface InvoiceItemPayload {
    name: string;
    quantity: number;
    unitType: string;
    unitPrice: number;
    price: number;
    VATRate: number;
    VATAmount: number;
}

export interface InvoicePayload {
    date: string;
    time: string;
    taxIDOrTRID: string;
    vknTckn: string;
    title: string;
    aliciUnvan: string;
    name: string;
    surname: string;
    taxOffice: string;
    fullAddress: string;
    district: string;
    city: string;
    country: string;
    ulke: string;
    currency: string;
    paraBirimi: string;
    currencyRate: string;
    dovzTLkur: string;
    invoiceType: string;
    faturaTipi: string;
    hangiTip: string;
    note?: string;
    items: InvoiceItemPayload[];
    totalVAT: number;
    grandTotal: number;
    grandTotalInclVAT: number;
    paymentTotal: number;
    [key: string]: unknown;
}

// Fatura Formu Verisini Hazırla
function getInvoicePayload(): InvoicePayload | null {
    const taxIDOrTRID = (document.getElementById("taxIDOrTRID") as HTMLInputElement).value.trim();
    const title = (document.getElementById("title") as HTMLInputElement).value.trim();
    const name = (document.getElementById("name") as HTMLInputElement).value.trim();
    const surname = (document.getElementById("surname") as HTMLInputElement).value.trim();
    const taxOffice = (document.getElementById("taxOffice") as HTMLInputElement).value.trim();
    const fullAddress = (document.getElementById("fullAddress") as HTMLInputElement).value.trim();
    const district = "";
    const city = " ";
    const country = (document.getElementById("country") as HTMLInputElement)?.value.trim() || "Türkiye";
    const rawDate = (document.getElementById("invoiceDate") as HTMLInputElement).value;
    const time = (document.getElementById("invoiceTime") as HTMLInputElement).value;
    const currency = (document.getElementById("currency") as HTMLSelectElement).value;
    const invoiceType = (document.getElementById("invoiceType") as HTMLSelectElement)?.value || "SATIS";
    const currencyRateInput = document.getElementById("currencyRate") as HTMLInputElement;
    const currencyRate = currencyRateInput?.value.trim() || "0";
    const note = (document.getElementById("invoiceNote") as HTMLInputElement)?.value.trim() || "";

    if (!taxIDOrTRID) {
        showToast("Lütfen TCKN veya VKN giriniz.", "warning");
        return null;
    }
    if (!fullAddress) {
        showToast("Lütfen adres bilgisini giriniz.", "warning");
        return null;
    }
    if (!rawDate) {
        showToast("Lütfen fatura tarihini seçiniz.", "warning");
        return null;
    }
    if (currency !== "TRY" && (!currencyRate || Number(currencyRate) <= 0)) {
        showToast("Dövizli faturalarda (USD, EUR vb.) Döviz Kuru girilmesi zorunludur.", "warning");
        if (currencyRateInput) currencyRateInput.focus();
        return null;
    }
    if (state.items.length === 0) {
        showToast("Lütfen faturaya en az bir mal veya hizmet kalemi ekleyin.", "warning");
        return null;
    }

    // GİB GG/AA/YYYY formatı bekler
    const [y, m, d] = rawDate.split("-");
    const formattedDate = `${d}/${m}/${y}`;

    let subtotal = 0;
    let totalVat = 0;
    let grandTotal = 0;

    const items = state.items.map((it) => {
        subtotal += it.price;
        totalVat += it.vatAmount;
        grandTotal += it.total;

        return {
            name: it.name || "Hizmet / Ürün",
            quantity: it.quantity,
            unitType: it.unitType,
            unitPrice: it.unitPrice,
            price: it.price,
            VATRate: it.vatRate,
            VATAmount: it.vatAmount,
        };
    });

    return {
        date: formattedDate,
        time: time || "12:00:00",
        taxIDOrTRID,
        vknTckn: taxIDOrTRID,
        title,
        aliciUnvan: title,
        name,
        surname,
        taxOffice,
        fullAddress,
        district,
        city,
        country,
        ulke: country,
        currency,
        paraBirimi: currency,
        currencyRate,
        dovzTLkur: currencyRate,
        invoiceType,
        faturaTipi: invoiceType,
        hangiTip: "5000/30000",
        note: note || undefined,
        items,
        totalVAT: totalVat,
        grandTotal: subtotal,
        grandTotalInclVAT: grandTotal,
        paymentTotal: grandTotal,
    };
}

// ─── API ÇAĞRILARI ──────────────────────────────────────────────────────────

// 1. Giriş Yap
async function handleLogin(e: Event): Promise<void> {
    e.preventDefault();
    const env = (document.getElementById("loginEnv") as HTMLSelectElement).value as "TEST" | "PROD";
    const username = (document.getElementById("loginUsername") as HTMLInputElement).value.trim();
    const password = (document.getElementById("loginPassword") as HTMLInputElement).value.trim();
    const submitBtn = document.getElementById("btnLoginSubmit") as HTMLButtonElement;
    const spinner = document.getElementById("loginSpinner");

    if (!username || !password) {
        showToast("Kullanıcı kodu ve parola zorunludur.", "warning");
        return;
    }

    try {
        submitBtn.disabled = true;
        if (spinner) spinner.classList.remove("d-none");

        const client = getGibClient(env);
        const token = await client.getToken(username, password);

        state.token = token;
        state.env = env;
        state.userCode = username;
        state.username = username;
        sessionStorage.setItem("gib_token", token);
        sessionStorage.setItem("gib_env", env);
        sessionStorage.setItem("gib_user_code", username);
        sessionStorage.setItem("gib_username", username);

        const rememberMe = (document.getElementById("rememberMeCheck") as HTMLInputElement | null)?.checked ?? true;
        if (rememberMe) {
            localStorage.setItem("gib_user_code", username);
            localStorage.setItem("gib_last_username", username);
        } else {
            localStorage.removeItem("gib_user_code");
            localStorage.removeItem("gib_last_username");
        }

        updateSessionUI();
        showToast("GİB Portal oturumu başarıyla açıldı!", "success");

        // Modalı kapat
        const modalEl = document.getElementById("loginModal");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        // Kullanıcı verilerini çek
        loadUserData();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Giriş Hatası: ${msg}`, "danger");
    } finally {
        submitBtn.disabled = false;
        if (spinner) spinner.classList.add("d-none");
    }
}

// Fatura Formunu ve Kalemlerini Sıfırla
function resetInvoiceForm(): void {
    const taxInput = document.getElementById("taxIDOrTRID") as HTMLInputElement | null;
    const titleInput = document.getElementById("title") as HTMLInputElement | null;
    const nameInput = document.getElementById("name") as HTMLInputElement | null;
    const surnameInput = document.getElementById("surname") as HTMLInputElement | null;
    const taxOfficeInput = document.getElementById("taxOffice") as HTMLInputElement | null;
    const addressInput = document.getElementById("fullAddress") as HTMLInputElement | null;
    const countryInput = document.getElementById("country") as HTMLInputElement | null;
    const invoiceTypeSelect = document.getElementById("invoiceType") as HTMLSelectElement | null;
    const currencySelect = document.getElementById("currency") as HTMLSelectElement | null;
    const currencyRateInput = document.getElementById("currencyRate") as HTMLInputElement | null;
    const currencyRateGroup = document.getElementById("currencyRateGroup");
    const invoiceNoteInput = document.getElementById("invoiceNote") as HTMLInputElement | null;

    if (taxInput) taxInput.value = "";
    if (titleInput) titleInput.value = "";
    if (nameInput) nameInput.value = "";
    if (surnameInput) surnameInput.value = "";
    if (taxOfficeInput) taxOfficeInput.value = "";
    if (addressInput) addressInput.value = "";
    if (countryInput) countryInput.value = "Türkiye";
    if (invoiceNoteInput) invoiceNoteInput.value = "";
    if (invoiceTypeSelect) {
        invoiceTypeSelect.value = "SATIS";
        invoiceTypeSelect.dispatchEvent(new Event("change"));
    }
    if (currencySelect) {
        currencySelect.value = "TRY";
        currencySelect.dispatchEvent(new Event("change"));
    }
    if (currencyRateInput) currencyRateInput.value = "";
    if (currencyRateGroup) currencyRateGroup.classList.add("d-none");

    initDateFields();

    state.items = [];
    renderItems();
    updateSummary();
}

// 2. Çıkış Yap ve Genel Temizlik
async function handleLogout(): Promise<void> {
    if (state.token) {
        try {
            const client = getGibClient(state.env);
            await client.logout(state.token);
        } catch {
            // yut
        }
    }

    // 1. Oturum durumunu sıfırla
    state.token = null;
    state.username = null;
    state.userCode = null;
    sessionStorage.removeItem("gib_token");
    sessionStorage.removeItem("gib_username");
    sessionStorage.removeItem("gib_user_code");

    // 2. Fatura listesini ve sayacını temizle
    state.invoices = [];
    state.selectedDraftForCancel = null;
    state.currentPreviewUuid = null;
    state.currentJsonModalData = null;
    state.currentDraftDetailItem = null;
    renderInvoicesTable();

    // 3. Mükellef profil kartını temizle
    const userContainer = document.getElementById("userDataContainer");
    if (userContainer) {
        userContainer.innerHTML = `
            <div class="text-center py-4 text-muted">
                <i class="bi bi-shield-lock fs-2 d-block mb-2 text-secondary"></i>
                Mükellef profil bilgilerini görüntülemek için lütfen GİB girişi yapınız.
            </div>
        `;
    }

    // 4. Yeni Fatura Kes formunu ve kalemlerini varsayılana döndür
    resetInvoiceForm();

    // 5. Giriş modalındaki alanları temizle
    const loginUser = document.getElementById("loginUsername") as HTMLInputElement | null;
    const loginPass = document.getElementById("loginPassword") as HTMLInputElement | null;
    if (loginUser) loginUser.value = "";
    if (loginPass) loginPass.value = "";

    // 6. İlk sekmeye dön (Yeni Fatura Kes)
    const tabCreateBtn = document.getElementById("tab-create-btn") as HTMLButtonElement | null;
    if (tabCreateBtn) tabCreateBtn.click();

    // 7. Navbar oturum durumunu güncelle
    updateSessionUI();
    showToast("Oturum kapatıldı ve tüm ekran verileri temizlendi.", "info");
}

// 3. VKN / TCKN ile Alıcı Bilgisi Getir
async function handleFetchRecipient(): Promise<void> {
    if (!state.token) {
        showToast("Alıcı sorgulamak için önce giriş yapmalısınız.", "warning");
        return;
    }
    const taxIdInput = document.getElementById("taxIDOrTRID") as HTMLInputElement;
    const taxId = taxIdInput.value.trim();

    if (!taxId || taxId.length < 10) {
        showToast("Lütfen geçerli 10 haneli VKN veya 11 haneli TCKN giriniz.", "warning");
        return;
    }

    const btn = document.getElementById("btnFetchRecipient") as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;

    try {
        const client = getGibClient(state.env);
        const dataRaw = await client.getRecipientData(state.token, taxId);
        const data = ((dataRaw as Record<string, unknown>)?.data || dataRaw) as Record<string, string | undefined> | undefined;

        if (data) {
            const titleInput = document.getElementById("title") as HTMLInputElement;
            const nameInput = document.getElementById("name") as HTMLInputElement;
            const surnameInput = document.getElementById("surname") as HTMLInputElement;
            const taxOfficeInput = document.getElementById("taxOffice") as HTMLInputElement;

            if (data.unvan && titleInput) titleInput.value = data.unvan;
            if (data.adi && nameInput) nameInput.value = data.adi;
            if (data.soyadi && surnameInput) surnameInput.value = data.soyadi;
            if (data.vergiDairesi && taxOfficeInput) taxOfficeInput.value = data.vergiDairesi;

            showToast("Alıcı bilgileri GİB'den başarıyla getirildi.", "success");
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Alıcı Sorgulama Hatası: ${msg}`, "danger");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-search"></i> Getir`;
    }
}

// 4. Fatura Oluştur (Taslak veya İmzalı)
async function handleCreateInvoice(sign: boolean): Promise<void> {
    if (!state.token) {
        showToast("Fatura kesmek için lütfen önce giriş yapınız.", "warning");
        const modalEl = document.getElementById("loginModal");
        if (modalEl) new bootstrap.Modal(modalEl).show();
        return;
    }

    const payload = getInvoicePayload();
    if (!payload) return;

    if (sign && state.env === "PROD") {
        const confirmed = confirm("DİKKAT: CANLI (PROD) ortamda fatura imzalamak üzeresiniz! Bu resmi bir mali işlemdir. Devam etmek istiyor musunuz?");
        if (!confirmed) return;
    }

    const btn = document.getElementById(sign ? "btnCreateAndSign" : "btnCreateDraft") as HTMLButtonElement;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> İşleniyor...`;

    try {
        const client = getGibClient(state.env);
        const data = await client.createInvoice(state.token, payload, sign);

        const draft = data.draft;
        const uuid = draft?.uuid || data.foundInvoice?.ettn;

        if (uuid) {
            saveInvoiceToCache(uuid, payload);
        }

        if (data.signed && uuid) {
            showToast("Fatura başarıyla oluşturuldu ve imzalandı!", "success");
            previewInvoiceHtml(uuid, true);
        } else {
            showToast(`Taslak fatura başarıyla oluşturuldu! ${uuid ? "(ETTN: " + uuid.substring(0, 8) + "...)" : ""}`, "success");
            // Faturalar sekmesine geç ve listele
            const tabBtn = document.querySelector('[data-bs-target="#tab-list"]') as HTMLButtonElement | null;
            if (tabBtn) tabBtn.click();
            handleListInvoices();
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Fatura Oluşturma Hatası: ${msg}`, "danger");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// 5. HTML Önizle (Kaydedilmiş Taslak veya Onaylı Belge)
async function previewInvoiceHtml(uuid: string, onayDurumu: string | boolean = "Onaylanmadı", belgeNo?: string): Promise<void> {
    if (!state.token) {
        showToast("Önizleme için giriş yapmış olmalısınız.", "warning");
        return;
    }

    const onayStr = typeof onayDurumu === "boolean" ? (onayDurumu ? "Onaylandı" : "Onaylanmadı") : onayDurumu;
    const isSigned = onayStr === "Onaylandı";
    state.currentPreviewUuid = uuid;
    state.currentPreviewSigned = isSigned;
    state.currentPreviewBelgeNo = belgeNo || null;

    const titleEl = document.getElementById("previewModalTitle");
    const subTitleEl = document.getElementById("previewModalSubtitle");
    if (titleEl) titleEl.textContent = `Fatura Önizleme - ${belgeNo || "Taslak"}`;
    if (subTitleEl) subTitleEl.textContent = `ETTN: ${uuid} (${onayStr})`;

    const overlay = document.getElementById("previewLoadingOverlay");
    const overlayText = document.getElementById("previewLoadingText");
    if (overlay) overlay.classList.remove("d-none");
    if (overlayText) overlayText.textContent = "Fatura HTML verisi GİB'den alınıyor...";

    const modalEl = document.getElementById("previewModal");
    if (modalEl) new bootstrap.Modal(modalEl).show();

    try {
        const client = getGibClient(state.env);
        const html = await client.getInvoiceHTML(state.token, uuid, isSigned);
        if (!html) throw new Error("GİB'den fatura HTML verisi alınamadı.");

        state.currentPreviewHtml = html;
        const iframe = document.getElementById("previewIframe") as HTMLIFrameElement;
        if (iframe) {
            iframe.srcdoc = html;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Önizleme Hatası: ${msg}`, "warning");
        const item = state.invoices.find((i) => (i.ettn || i.uuid) === uuid);
        if (item) {
            showDraftDetailModal(item as Record<string, unknown>);
        }
    } finally {
        if (overlay) overlay.classList.add("d-none");
    }
}

// Doğrudan PDF İndir (UUID veya Belge No ile)
async function downloadInvoicePdf(uuid: string, onayDurumu: string = "Onaylanmadı", belgeNo?: string): Promise<void> {
    if (!state.token) {
        showToast("PDF indirmek için lütfen giriş yapınız.", "warning");
        return;
    }

    const overlay = document.getElementById("previewLoadingOverlay");
    const overlayText = document.getElementById("previewLoadingText");
    if (overlay) overlay.classList.remove("d-none");
    if (overlayText) overlayText.textContent = "Fatura HTML verisi GİB'den alınıyor...";

    showToast("PDF hazırlanıyor, lütfen bekleyin...", "info");

    try {
        const client = getGibClient(state.env);
        const isSigned = onayDurumu === "Onaylandı";
        const html = await client.getInvoiceHTML(state.token, uuid, isSigned);
        if (!html) throw new Error("GİB'den fatura HTML verisi alınamadı.");

        const filename = `fatura-${belgeNo || uuid}.pdf`;
        if (overlayText) overlayText.textContent = "PDF dosyası oluşturuluyor...";
        await generatePdfFromHtml(html, filename);

        showToast(`PDF başarıyla indirildi: ${filename}`, "success");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`PDF İndirme Hatası: ${msg}`, "danger");
    } finally {
        if (overlay) overlay.classList.add("d-none");
    }
}

// Önizleme Modalındaki İçeriği Doğrudan PDF İndir
async function downloadCurrentPreviewPdf(): Promise<void> {
    if (state.currentPreviewUuid && state.token) {
        await downloadInvoicePdf(
            state.currentPreviewUuid,
            state.currentPreviewSigned ? "Onaylandı" : "Onaylanmadı",
            state.currentPreviewBelgeNo || undefined
        );
        return;
    }

    // Yerel Taslak Önizlemesi ise (veya henüz kaydedilmemişse)
    const iframe = document.getElementById("previewIframe") as HTMLIFrameElement;
    const html = state.currentPreviewHtml || iframe?.srcdoc;
    if (!html) {
        showToast("İndirilecek önizleme içeriği bulunamadı.", "warning");
        return;
    }

    const overlay = document.getElementById("previewLoadingOverlay");
    const overlayText = document.getElementById("previewLoadingText");
    if (overlay) overlay.classList.remove("d-none");
    if (overlayText) overlayText.textContent = "Taslak PDF formatına dönüştürülüyor...";

    showToast("Taslak PDF hazırlanıyor...", "info");
    try {
        const filename = "fatura-taslak.pdf";
        await generatePdfFromHtml(html, filename);
        showToast("Taslak PDF başarıyla indirildi!", "success");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`PDF Dönüştürme Hatası: ${msg}`, "danger");
    } finally {
        if (overlay) overlay.classList.add("d-none");
    }
}

// Önizlemeyi Yeni Sekmede Aç
function openPreviewInNewTab(): void {
    const iframe = document.getElementById("previewIframe") as HTMLIFrameElement;
    const html = state.currentPreviewHtml || iframe?.srcdoc;
    if (!html) {
        showToast("Önizleme içeriği bulunamadı.", "warning");
        return;
    }

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
}

// Önizleme Modalında Tam Ekran Geçişi
function toggleFullscreenPreview(): void {
    const dialog = document.getElementById("previewModalDialog");
    const btn = document.getElementById("btnToggleFullscreenPreview");
    if (!dialog) return;

    dialog.classList.toggle("modal-fullscreen-preview");
    const isFullscreen = dialog.classList.contains("modal-fullscreen-preview");
    if (btn) {
        btn.innerHTML = isFullscreen
            ? `<i class="bi bi-fullscreen-exit"></i>`
            : `<i class="bi bi-arrows-fullscreen"></i>`;
        btn.title = isFullscreen ? "Normal Boyuta Dön" : "Tam Ekran Yap";
    }
}

// 6. Faturaları Listele
async function handleListInvoices(): Promise<void> {
    if (!state.token) {
        showToast("Faturaları listelemek için lütfen giriş yapınız.", "warning");
        return;
    }

    const startVal = (document.getElementById("filterStartDate") as HTMLInputElement).value;
    const endVal = (document.getElementById("filterEndDate") as HTMLInputElement).value;
    const typeVal = (document.getElementById("filterType") as HTMLSelectElement).value;

    if (!startVal || !endVal) {
        showToast("Lütfen tarih aralığı seçiniz.", "warning");
        return;
    }

    const [sy, sm, sd] = startVal.split("-").map(Number);
    const [ey, em, ed] = endVal.split("-").map(Number);
    const sDate = new Date(sy, sm - 1, sd);
    const eDate = new Date(ey, em - 1, ed);
    const dayCount = Math.round((eDate.getTime() - sDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    if (dayCount < 1) {
        showToast("Başlangıç tarihi bitiş tarihinden sonra olamaz.", "warning");
        return;
    }
    if (dayCount > 7) {
        showToast(`GİB e-Arşiv kuralı gereği tarih aralığı en fazla 7 gün olabilir (Seçilen: ${dayCount} gün). Bitiş tarihi 7 güne sınırlandırıldı.`, "warning");
        syncDateInputsConstraint("start");
        return;
    }

    const pad = (n: number) => n.toString().padStart(2, "0");
    const startDate = `${pad(sd)}/${pad(sm)}/${sy}`;
    const endDate = `${pad(ed)}/${pad(em)}/${ey}`;

    const btn = document.getElementById("btnListInvoices") as HTMLButtonElement | null;
    const quickGroup = document.getElementById("quickDateGroup");
    const quickButtons = quickGroup ? quickGroup.querySelectorAll("button") : [];

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Listeleniyor...`;
    }
    quickButtons.forEach((b) => (b.disabled = true));

    try {
        const client = getGibClient(state.env);
        let invoices: InvoiceListItem[];
        if (typeVal === "incoming") {
            invoices = await client.getIncomingInvoices(state.token, startDate, endDate);
        } else {
            invoices = await client.getOutgoingInvoices(state.token, startDate, endDate);
        }

        state.invoices = invoices;
        renderInvoicesTable();
        showToast(`${state.invoices.length} adet fatura listelendi.`, "success");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Listeleme Hatası: ${msg}`, "danger");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="bi bi-arrow-clockwise me-1"></i> Faturaları Listele`;
        }
        quickButtons.forEach((b) => (b.disabled = false));
    }
}

// Fatura Listesi Tablosunu Çiz
function renderInvoicesTable(): void {
    const tbody = document.getElementById("invoicesTableBody");
    const badge = document.getElementById("invoiceCountBadge");
    if (!tbody) return;

    if (!state.token) {
        if (badge) badge.textContent = "0 fatura";
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4 text-muted">
                    <i class="bi bi-shield-lock fs-2 d-block mb-2 text-secondary"></i>
                    Faturaları görüntülemek ve sorgulamak için lütfen GİB girişi yapınız.
                </td>
            </tr>
        `;
        return;
    }

    const searchInput = document.getElementById("invoiceSearchInput") as HTMLInputElement | null;
    const query = (searchInput?.value || "").toLowerCase().trim();

    // İstatistikleri hesapla
    let totalInvoices = state.invoices.length;
    let signedCount = 0;
    let draftCount = 0;
    let totalAmountTRY = 0;

    state.invoices.forEach((inv) => {
        const rawOnay = String(inv.onayDurumu || "Taslak").trim().toLowerCase();
        const isDel = rawOnay === "silinmiş" || rawOnay === "iptal edildi";
        const isSign = !isDel && (rawOnay === "onaylandı" || rawOnay === "1" || inv.onayDurumu === true);
        if (isSign) signedCount++;
        else if (!isDel) draftCount++;

        const tVal = inv.odenecek ?? inv.toplamTutar ?? inv.faturaTutari ?? inv.odenecekTutar ?? inv.malHizmetToplamTutari ?? inv.tutar;
        if (typeof tVal === "number") {
            totalAmountTRY += tVal;
        } else if (typeof tVal === "string") {
            const parsed = parseFloat(tVal.replace(/\./g, "").replace(",", "."));
            if (!isNaN(parsed)) totalAmountTRY += parsed;
        }
    });

    const statTotalEl = document.getElementById("statTotalInvoices");
    const statSignedEl = document.getElementById("statSignedCount");
    const statDraftEl = document.getElementById("statDraftCount");
    const statAmountEl = document.getElementById("statTotalAmount");

    if (statTotalEl) statTotalEl.textContent = String(totalInvoices);
    if (statSignedEl) statSignedEl.textContent = String(signedCount);
    if (statDraftEl) statDraftEl.textContent = String(draftCount);
    if (statAmountEl) statAmountEl.textContent = totalAmountTRY > 0 ? formatMoney(totalAmountTRY, "TRY") : "-";

    const statusFilter = state.invoiceStatusFilter || "all";
    const filteredInvoices = state.invoices.filter((inv) => {
        // Durum Filtresi
        if (statusFilter !== "all") {
            const rawOnay = String(inv.onayDurumu || "Taslak").trim().toLowerCase();
            const isDel = rawOnay === "silinmiş" || rawOnay === "iptal edildi";
            const isSign = !isDel && (rawOnay === "onaylandı" || rawOnay === "1" || inv.onayDurumu === true);
            const isDrf = !isDel && !isSign;

            if (statusFilter === "signed" && !isSign) return false;
            if (statusFilter === "draft" && !isDrf) return false;
            if (statusFilter === "deleted" && !isDel) return false;
        }

        // Metin Arama Filtresi
        if (query) {
            const ettn = String(inv.ettn || inv.uuid || "").toLowerCase();
            const belgeNo = String(inv.belgeNumarasi || "").toLowerCase();
            const alici = String(inv.aliciUnvanAdSoyad || inv.aliciUnvan || `${inv.aliciAdi || ""} ${inv.aliciSoyadi || ""}`).toLowerCase();
            const vkn = String(inv.aliciVknTckn || inv.vknTckn || "").toLowerCase();
            return ettn.includes(query) || belgeNo.includes(query) || alici.includes(query) || vkn.includes(query);
        }

        return true;
    });

    if (badge) {
        badge.textContent = (query || statusFilter !== "all")
            ? `${filteredInvoices.length} / ${state.invoices.length} fatura`
            : `${state.invoices.length} fatura`;
    }

    if (filteredInvoices.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4 text-muted">
                    <i class="bi bi-folder2-open fs-2 d-block mb-2"></i>
                    ${query ? `"${query}" aramasına uygun fatura bulunamadı.` : "Belirtilen tarih aralığında fatura bulunamadı."}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = "";
    filteredInvoices.forEach((inv) => {
        const ettn = (inv.ettn || inv.uuid || "-") as string;
        const rawBelgeNo = (inv.belgeNumarasi || "").toString().trim();
        const belgeNo = rawBelgeNo || "Taslak";
        
        // GİB response: belgeTarihi = "06-10-2026" veya faturaTarihi
        const tarih = (inv.belgeTarihi || inv.faturaTarihi || inv.date || "-") as string;
        
        // GİB response: aliciUnvanAdSoyad veya aliciUnvan
        const aliciUnvan = (inv.aliciUnvanAdSoyad || inv.aliciUnvan || `${inv.aliciAdi || ""} ${inv.aliciSoyadi || ""}`.trim() || "-") as string;
        const aliciVkn = (inv.aliciVknTckn || inv.vknTckn || "") as string;
        
        const belgeTuru = (inv.belgeTuru || "FATURA") as string;
        const tutarVal = inv.odenecek ?? inv.toplamTutar ?? inv.faturaTutari ?? inv.odenecekTutar ?? inv.malHizmetToplamTutari ?? inv.tutar;
        const hasTutar = tutarVal !== undefined && tutarVal !== null && tutarVal !== "" && tutarVal !== "-";
        
        // Onay Durumu ("Onaylandı" / "Onaylanmadı" / "Silinmiş")
        const rawOnay = String(inv.onayDurumu || "Taslak").trim();
        const isDeleted = rawOnay.toLowerCase() === "silinmiş" || rawOnay.toLowerCase() === "iptal edildi";
        const isSigned = !isDeleted && (rawOnay.toLowerCase() === "onaylandı" || rawOnay === "1" || inv.onayDurumu === true);

        // Durum Rozeti
        let statusBadge = "";
        if (isDeleted) {
            statusBadge = `<span class="badge badge-status-deleted"><i class="bi bi-x-circle me-1"></i>Silinmiş</span>`;
        } else if (isSigned) {
            statusBadge = `<span class="badge badge-status-signed"><i class="bi bi-check-circle me-1"></i>Onaylandı</span>`;
        } else {
            statusBadge = `<span class="badge badge-status-draft"><i class="bi bi-clock-history me-1"></i>Taslak</span>`;
        }

        // İşlem Butonları
        let actionButtons = "";
        if (isDeleted) {
            // Silinmiş belgeler
            actionButtons = `
                <button class="btn btn-outline-secondary btn-action-view" data-uuid="${ettn}" data-onay="Silinmiş" data-belgeno="${rawBelgeNo}" title="Görüntüle (HTML)">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-action-pdf" data-uuid="${ettn}" data-onay="Silinmiş" data-belgeno="${rawBelgeNo}" title="Doğrudan PDF İndir">
                    <i class="bi bi-file-earmark-pdf"></i>
                </button>
            `;
        } else if (isSigned) {
            // Onaylı (İmzalı) belgeler: Görüntüle, Doğrudan PDF İndir, ZIP İndir
            actionButtons = `
                <button class="btn btn-outline-primary btn-action-view" data-uuid="${ettn}" data-onay="Onaylandı" data-belgeno="${rawBelgeNo}" title="Görüntüle (HTML)">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-action-pdf" data-uuid="${ettn}" data-onay="Onaylandı" data-belgeno="${rawBelgeNo}" title="Doğrudan PDF İndir">
                    <i class="bi bi-file-earmark-pdf"></i> PDF
                </button>
                <a href="${getGibClient(state.env).getDownloadURL(state.token || '', ettn, true)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline-secondary" title="ZIP İndir (Resmi GİB)" download="fatura-${rawBelgeNo || ettn}.zip">
                    <i class="bi bi-download"></i>
                </a>
            `;
        } else {
            // Aktif taslak (Onaylanmadı): Görüntüle, Doğrudan PDF İndir, Onayla, Sil
            actionButtons = `
                <button class="btn btn-outline-primary btn-action-view" data-uuid="${ettn}" data-onay="Onaylanmadı" data-belgeno="${rawBelgeNo}" title="Görüntüle (HTML)">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-action-pdf" data-uuid="${ettn}" data-onay="Onaylanmadı" data-belgeno="${rawBelgeNo}" title="Doğrudan PDF İndir">
                    <i class="bi bi-file-earmark-pdf"></i> PDF
                </button>
                <button class="btn btn-outline-success btn-action-sign" data-uuid="${ettn}" title="İmzala (Onayla)">
                    <i class="bi bi-check-lg"></i>
                </button>
                <button class="btn btn-outline-danger btn-action-cancel" data-uuid="${ettn}" title="İptal Et / Sil">
                    <i class="bi bi-trash"></i>
                </button>
            `;
        }

        actionButtons += `
            <button class="btn btn-outline-primary btn-action-clone" data-uuid="${ettn}" title="Bu Faturayı Kopyala (Yeni Fatura Olarak Doldur)">
                <i class="bi bi-copy"></i>
            </button>
            <button class="btn btn-outline-info btn-action-json" data-uuid="${ettn}" title="Ham JSON Göster">
                <i class="bi bi-code-slash"></i>
            </button>
        `;

        const tr = document.createElement("tr");
        if (isDeleted) tr.className = "table-light text-muted";
        tr.innerHTML = `
            <td>
                <div class="d-flex align-items-center gap-2">
                    <span class="badge ${rawBelgeNo ? (isDeleted ? "bg-secondary" : "bg-primary") : (isDeleted ? "bg-light text-muted border" : "bg-secondary text-light")} font-monospace">${belgeNo}</span>
                </div>
                ${ettn && ettn !== "-" ? `
                <div class="d-flex align-items-center gap-1 mt-1 font-monospace" style="font-size: 0.75rem;">
                    <span class="text-muted text-truncate user-select-all" style="max-width: 140px;" title="${ettn}">${ettn}</span>
                    <button type="button" class="btn btn-link p-0 text-secondary btn-copy-ettn" data-copy="${ettn}" title="ETTN Kopyala">
                        <i class="bi bi-clipboard"></i>
                    </button>
                </div>` : ""}
            </td>
            <td>
                <span class="${isDeleted ? "text-muted" : "fw-semibold"}">${tarih}</span>
            </td>
            <td>
                <div class="${isDeleted ? "text-muted" : "fw-bold"}">${aliciUnvan}</div>
                ${aliciVkn ? `<div class="small text-muted font-monospace"><i class="bi bi-person-badge me-1"></i>${aliciVkn}</div>` : ""}
            </td>
            <td>
                <span class="badge bg-light text-dark border">${belgeTuru}</span>
                ${hasTutar ? `<div class="fw-semibold text-success mt-1">${typeof tutarVal === "number" ? formatMoney(tutarVal) : tutarVal}</div>` : ""}
            </td>
            <td>
                ${statusBadge}
            </td>
            <td class="text-end">
                <div class="btn-group btn-group-sm">
                    ${actionButtons}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 1. Yeni Fatura Olarak Kopyala Dinleyicisi
    tbody.querySelectorAll(".btn-action-clone").forEach((el) => {
        el.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-clone") as HTMLElement;
            if (btn && btn.dataset.uuid) {
                cloneInvoice(btn.dataset.uuid);
            }
        });
    });

    // 2. HTML Önizle Dinleyicisi
    tbody.querySelectorAll(".btn-action-view").forEach((el) => {
        el.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-view") as HTMLElement;
            if (btn && btn.dataset.uuid) {
                previewInvoiceHtml(btn.dataset.uuid, btn.dataset.onay || "Onaylanmadı", btn.dataset.belgeno);
            }
        });
    });

    // 2.1 Doğrudan PDF İndir Dinleyicisi
    tbody.querySelectorAll(".btn-action-pdf").forEach((el) => {
        el.addEventListener("click", async (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-pdf") as HTMLButtonElement;
            if (!btn || !btn.dataset.uuid) return;
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
            try {
                await downloadInvoicePdf(btn.dataset.uuid, btn.dataset.onay || "Onaylanmadı", btn.dataset.belgeno);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        });
    });

    // 2. Taslak Detay Bilgisi Dinleyicisi
    tbody.querySelectorAll(".btn-action-view-draft").forEach((el) => {
        el.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-view-draft") as HTMLElement;
            const uuid = btn?.dataset.uuid;
            const item = state.invoices.find((i) => (i.ettn || i.uuid) === uuid);
            if (item) showDraftDetailModal(item as Record<string, unknown>);
        });
    });

    // 3. Ham JSON Dinleyicisi
    tbody.querySelectorAll(".btn-action-json").forEach((el) => {
        el.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-json") as HTMLElement;
            const uuid = btn?.dataset.uuid;
            const item = state.invoices.find((i) => (i.ettn || i.uuid) === uuid);
            if (item) showJsonModal(item);
        });
    });

    // 4. İmzala Dinleyicisi
    tbody.querySelectorAll(".btn-action-sign").forEach((el) => {
        el.addEventListener("click", async (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-sign") as HTMLElement;
            const uuid = btn?.dataset.uuid;
            const inv = state.invoices.find((i) => (i.ettn || i.uuid) === uuid);
            if (!uuid || !state.token) return;

            const confirmMsg = state.env === "PROD"
                ? `DİKKAT: CANLI (PROD) ortamda bu faturayı imzalamak üzeresiniz!\nETTN: ${uuid}\nBu resmi bir mali onay işlemidir. Devam etmek istiyor musunuz?`
                : `Bu taslak faturayı imzalamak istiyor musunuz?\nETTN: ${uuid}`;

            if (confirm(confirmMsg)) {
                try {
                    showToast("Fatura imzalanıyor...", "info");
                    const client = getGibClient(state.env);
                    await client.signDraftInvoice(state.token, inv || ({ ettn: uuid } as InvoiceListItem));
                    showToast("Fatura başarıyla imzalandı!", "success");
                    handleListInvoices();
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    showToast(`İmza Hatası: ${msg}`, "danger");
                }
            }
        });
    });

    // 5. İptal / Sil Dinleyicisi
    tbody.querySelectorAll(".btn-action-cancel").forEach((el) => {
        el.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-cancel") as HTMLElement;
            const uuid = btn?.dataset.uuid;
            state.selectedDraftForCancel = state.invoices.find((i) => (i.ettn || i.uuid) === uuid) || null;
            const modalEl = document.getElementById("cancelModal");
            if (modalEl) new bootstrap.Modal(modalEl).show();
        });
    });

    // 6. ETTN Kopyalama Butonu Dinleyicisi
    tbody.querySelectorAll(".btn-copy-ettn").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const btn = (e.target as HTMLElement).closest(".btn-copy-ettn") as HTMLElement;
            const text = btn?.dataset.copy;
            if (!text) return;

            navigator.clipboard.writeText(text).then(() => {
                const icon = btn.querySelector("i");
                if (icon) {
                    icon.className = "bi bi-check2 text-success fw-bold";
                    setTimeout(() => {
                        icon.className = "bi bi-clipboard";
                    }, 1500);
                }
                showToast("ETTN panoya kopyalandı!", "success");
            }).catch(() => {
                showToast("Panoya kopyalanamadı.", "warning");
            });
        });
    });
}

// Faturaları CSV Formatında Dışa Aktar (UTF-8 BOM ile Excel uyumlu)
function exportInvoicesToCsv(): void {
    if (!state.invoices || state.invoices.length === 0) {
        showToast("Dışa aktarılacak fatura bulunamadı.", "warning");
        return;
    }

    const headers = [
        "Belge Numarası",
        "ETTN (UUID)",
        "Belge Tarihi",
        "Alıcı Ünvan / Ad Soyad",
        "Alıcı VKN / TCKN",
        "Belge Türü",
        "Onay Durumu",
        "Ödenecek Tutar"
    ];

    const escapeCsv = (str: unknown) => {
        if (str === undefined || str === null) return '""';
        const s = typeof str === "object" ? JSON.stringify(str) : String(str);
        return `"${s.replace(/"/g, '""')}"`;
    };

    const rows = state.invoices.map((inv) => {
        const ettn = (inv.ettn || inv.uuid || "") as string;
        const belgeNo = (inv.belgeNumarasi || "") as string;
        const tarih = (inv.belgeTarihi || inv.faturaTarihi || inv.date || "") as string;
        const aliciUnvan = (inv.aliciUnvanAdSoyad || inv.aliciUnvan || `${inv.aliciAdi || ""} ${inv.aliciSoyadi || ""}`.trim()) as string;
        const aliciVkn = (inv.aliciVknTckn || inv.vknTckn || "") as string;
        const belgeTuru = (inv.belgeTuru || "FATURA") as string;
        const rawOnay = String(inv.onayDurumu || "Taslak").trim();
        const tutarVal = inv.odenecek ?? inv.toplamTutar ?? inv.faturaTutari ?? inv.odenecekTutar ?? inv.malHizmetToplamTutari ?? inv.tutar ?? "";

        return [
            escapeCsv(belgeNo),
            escapeCsv(ettn),
            escapeCsv(tarih),
            escapeCsv(aliciUnvan),
            escapeCsv(aliciVkn),
            escapeCsv(belgeTuru),
            escapeCsv(rawOnay),
            escapeCsv(tutarVal)
        ].join(";");
    });

    // UTF-8 BOM ekleyerek Türkçe karakterlerin Excel'de doğru açılmasını sağla
    const csvContent = "\uFEFF" + [headers.map(h => `"${h}"`).join(";"), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `faturalar-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showToast(`${state.invoices.length} fatura CSV olarak indirildi.`, "success");
}

// JSON Modalı Göster
function showJsonModal(data: unknown): void {
    state.currentJsonModalData = data;
    const pre = document.getElementById("jsonModalContent");
    if (pre) pre.textContent = JSON.stringify(data, null, 2);
    const modalEl = document.getElementById("jsonModal");
    if (modalEl) new bootstrap.Modal(modalEl).show();
}

// Taslak Belge Bilgi Modalı Göster
function showDraftDetailModal(item: Record<string, unknown>): void {
    state.currentDraftDetailItem = item;
    const content = document.getElementById("draftDetailModalContent");
    if (!content) return;
    const ettn = String(item.ettn || item.uuid || "-");
    const tarih = String(item.belgeTarihi || item.faturaTarihi || "-");
    const alici = String(item.aliciUnvanAdSoyad || item.aliciUnvan || "-");
    const vkn = String(item.aliciVknTckn || item.vknTckn || "-");
    const belgeTuru = String(item.belgeTuru || "FATURA");
    const onay = String(item.onayDurumu || "Onaylanmadı");

    content.innerHTML = `
        <div class="alert alert-warning py-2 px-3 small mb-3">
            <i class="bi bi-info-circle-fill me-1"></i>
            <strong>GİB Kuralı:</strong> Taslak durumundaki (onaylanmamış) faturalar için GİB resmi HTML ve indirme bağlantısı üretmez. Belge onaylandığında resmi HTML görünümü oluşur.
        </div>
        <table class="table table-sm table-bordered mb-0">
            <tbody>
                <tr><th class="w-35 bg-light">ETTN (UUID)</th><td class="font-monospace user-select-all">${ettn}</td></tr>
                <tr><th class="bg-light">Belge Tarihi</th><td>${tarih}</td></tr>
                <tr><th class="bg-light">Alıcı Ünvan / Ad</th><td class="fw-bold">${alici}</td></tr>
                <tr><th class="bg-light">Alıcı VKN / TCKN</th><td class="font-monospace">${vkn}</td></tr>
                <tr><th class="bg-light">Belge Türü</th><td><span class="badge bg-light text-dark border">${belgeTuru}</span></td></tr>
                <tr><th class="bg-light">Onay Durumu</th><td><span class="badge bg-warning text-dark">${onay}</span></td></tr>
            </tbody>
        </table>
    `;
    const modalEl = document.getElementById("draftDetailModal");
    if (modalEl) new bootstrap.Modal(modalEl).show();
}

// Form İçin Yerel Fatura Taslak Önizlemesi (Resmi GİB sample.html Şablonu)
function showLocalInvoicePreview(payload: InvoicePayload): void {
    if (!payload) return;

    const previewHtml = generateGibInvoiceHtml(
        payload,
        state.userData,
        state.userCode,
        state.username
    );

    state.currentPreviewUuid = null;
    state.currentPreviewSigned = false;
    state.currentPreviewHtml = previewHtml;
    state.currentPreviewBelgeNo = "Taslak";

    const titleEl = document.getElementById("previewModalTitle");
    const subTitleEl = document.getElementById("previewModalSubtitle");
    if (titleEl) titleEl.textContent = "Resmi Taslak Önizleme";
    if (subTitleEl) subTitleEl.textContent = "GİB resmi e-Arşiv fatura şablonu ile hazırlanmış yerel önizleme";

    const iframe = document.getElementById("previewIframe") as HTMLIFrameElement;
    if (iframe) {
        iframe.srcdoc = previewHtml;
    }
    const modalEl = document.getElementById("previewModal");
    if (modalEl) new bootstrap.Modal(modalEl).show();
}

// 7. Kullanıcı Verilerini Yükle
async function loadUserData(): Promise<void> {
    const container = document.getElementById("userDataContainer");
    if (!container) return;

    if (!state.token) {
        container.innerHTML = `
            <div class="text-center py-4 text-muted">
                <i class="bi bi-shield-lock fs-2 d-block mb-2 text-secondary"></i>
                Mükellef profil bilgilerini görüntülemek için lütfen GİB girişi yapınız.
            </div>
        `;
        return;
    }

    // Yükleniyor durumu göster
    container.innerHTML = `
        <div class="text-center py-4 text-muted">
            <div class="spinner-border text-primary spinner-border-sm mb-2" role="status"></div>
            <div>Mükellef bilgileri GİB'den alınıyor...</div>
        </div>
    `;

    try {
        const currentUserCode = state.userCode || sessionStorage.getItem("gib_user_code") || localStorage.getItem("gib_user_code") || (document.getElementById("loginUsername") as HTMLInputElement)?.value.trim() || undefined;
        const client = getGibClient(state.env);
        const u = await client.getUserData(state.token);
        if (currentUserCode && !u.userCode) {
            u.userCode = currentUserCode;
        }
        state.userData = u as unknown as Record<string, unknown>;

            // Ünvan ve İsim
            const title = String(u.title || u.unvan || "").trim();
            const name = String(u.name || u.ad || u.adi || "").trim();
            const surname = String(u.surname || u.soyad || u.soyadi || "").trim();
            const fullName = [name, surname].filter(Boolean).join(" ");
            const displayTitle = title || fullName || "-";

            // VKN / TCKN
            const taxId = String(u.taxIDOrTRID || u.vknTckn || u.vergiKimlikNo || "").trim() || "-";

            // Vergi Dairesi
            const taxOffice = String(u.taxOffice || u.vergiDairesi || "").trim() || "-";

            // İletişim
            const phone = String(u.phoneNumber || u.telNo || "").trim();
            const email = String(u.email || u.ePostaAdresi || "").trim();
            const contactInfo = [phone, email].filter(Boolean).join(" / ") || "-";

            // Web sitesi
            const web = String(u.webSite || u.webSitesiAdresi || "").trim();

            // Sicil / Mersis
            const registryNo = String(u.registryNo || u.sicilNo || "").trim();
            const mersisNo = String(u.mersisNo || "").trim();

            // Adres parçaları
            const street = String(u.fullAddress || u.cadde || u.caddeSokak || "").trim();
            const bldName = String(u.buildingName || u.apartmanAdi || "").trim();
            const bldNo = String(u.buildingNumber || u.apartmanNo || "").trim();
            const doorNo = String(u.doorNumber || u.kapiNo || "").trim();
            const town = String(u.town || u.kasaba || "").trim();
            const district = String(u.district || u.ilce || "").trim();
            const city = String(u.city || u.il || "").trim();
            const zip = String(u.zipCode || u.postaKodu || "").trim();
            const country = String(u.country || u.ulke || "Türkiye").trim();

            const addrParts: string[] = [];
            if (street) addrParts.push(street);
            if (bldName) addrParts.push(bldName);
            if (bldNo) addrParts.push(`No: ${bldNo}`);
            if (doorNo) addrParts.push(`Daire: ${doorNo}`);
            if (town) addrParts.push(town);
            if (district || city) addrParts.push([district, city].filter(Boolean).join(" / "));
            if (zip) addrParts.push(zip);
            if (country) addrParts.push(country);

            const displayAddress = addrParts.join(" ") || "-";

            // Kullanıcı Kodu (Login olurken kullanılan değer)
            const inputLoginVal = (document.getElementById("loginUsername") as HTMLInputElement)?.value.trim();
            const userCode =
                String(u.userCode || "").trim() ||
                state.userCode ||
                sessionStorage.getItem("gib_user_code") ||
                localStorage.getItem("gib_user_code") ||
                inputLoginVal ||
                "-";

            if (userCode && userCode !== "-") {
                state.userCode = userCode;
                sessionStorage.setItem("gib_user_code", userCode);
                localStorage.setItem("gib_user_code", userCode);
            }

            // Navbar'daki kullanıcı adını da güncelle
            if (displayTitle && displayTitle !== "-") {
                state.username = displayTitle;
                updateSessionUI();
            }

            container.innerHTML = `
                <div class="row g-4">
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-1 fw-semibold">
                            <i class="bi bi-building text-primary me-1"></i>Ünvan / Ad Soyad
                        </label>
                        <div class="fw-bold fs-6 text-dark">${displayTitle}</div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-1 fw-semibold">
                            <i class="bi bi-person-badge text-primary me-1"></i>Kullanıcı Kodu
                        </label>
                        <div class="d-flex align-items-center gap-2">
                            <span class="fw-bold fs-6 font-monospace text-dark bg-light px-2 py-1 rounded border">${userCode}</span>
                            ${userCode !== "-" ? `
                            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size: 0.75rem; height: 28px;" id="btnCopyUserCode" title="Kullanıcı kodunu panoya kopyala">
                                <i class="bi bi-clipboard me-1"></i>Kopyala
                            </button>
                            ` : ""}
                        </div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-1 fw-semibold">
                            <i class="bi bi-hash text-primary me-1"></i>VKN / TCKN
                        </label>
                        <div class="fw-bold fs-6 text-primary">${taxId}</div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-1 fw-semibold">
                            <i class="bi bi-bank text-primary me-1"></i>Vergi Dairesi
                        </label>
                        <div class="text-secondary fw-semibold">${taxOffice}</div>
                    </div>
                    <div class="col-12">
                        <label class="form-label text-muted small mb-1 fw-semibold">
                            <i class="bi bi-telephone text-primary me-1"></i>İletişim (Telefon / E-posta)
                        </label>
                        <div class="text-secondary">${contactInfo}</div>
                    </div>
                    <div class="col-12">
                        <label class="form-label text-muted small mb-1 fw-semibold">
                            <i class="bi bi-geo-alt text-primary me-1"></i>Mükellef Adresi
                        </label>
                        <div class="text-secondary p-3 bg-light rounded border">${displayAddress}</div>
                    </div>
                    ${mersisNo || registryNo || web ? `
                    <div class="col-12 pt-2 border-top">
                        <div class="row g-3 text-muted small">
                            ${mersisNo ? `<div class="col-md-4"><strong>Mersis No:</strong> ${mersisNo}</div>` : ""}
                            ${registryNo ? `<div class="col-md-4"><strong>Ticaret Sicil No:</strong> ${registryNo}</div>` : ""}
                            ${web ? `<div class="col-md-4"><strong>Web:</strong> ${web}</div>` : ""}
                        </div>
                    </div>
                    ` : ""}
                </div>
            `;

            const btnCopyCode = document.getElementById("btnCopyUserCode");
            if (btnCopyCode) {
                btnCopyCode.addEventListener("click", () => {
                    navigator.clipboard.writeText(userCode).then(() => {
                        showToast(`Kullanıcı kodu kopyalandı: ${userCode}`, "info");
                    });
                });
            }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        container.innerHTML = `
            <div class="alert alert-danger mb-0 d-flex justify-content-between align-items-center">
                <div><i class="bi bi-exclamation-octagon me-2"></i>Mükellef bilgileri yüklenemedi: ${msg}</div>
                <button class="btn btn-sm btn-outline-danger" id="btnRetryUserData">Tekrar Dene</button>
            </div>
        `;
        document.getElementById("btnRetryUserData")?.addEventListener("click", () => loadUserData());
    }
}

// Örnek Test Verisi Doldurucu
function fillSampleData(): void {
    (document.getElementById("taxIDOrTRID") as HTMLInputElement).value = "11111111111";
    (document.getElementById("title") as HTMLInputElement).value = "";
    (document.getElementById("name") as HTMLInputElement).value = "Ahmet";
    (document.getElementById("surname") as HTMLInputElement).value = "Yılmaz";
    (document.getElementById("taxOffice") as HTMLInputElement).value = "Kadıköy";
    (document.getElementById("fullAddress") as HTMLInputElement).value = "Bağdat Caddesi No: 42 Daire: 5";
    const countryEl = document.getElementById("country") as HTMLInputElement | null;
    if (countryEl) countryEl.value = "Türkiye";

    state.items = [
        {
            id: "sample-1",
            name: "Yazılım Danışmanlık Hizmeti",
            quantity: 1,
            unitType: "C62",
            unitPrice: 5000,
            vatRate: 20,
            price: 5000,
            vatAmount: 1000,
            total: 6000,
        },
        {
            id: "sample-2",
            name: "Sunucu Bakım Desteği",
            quantity: 2,
            unitType: "HUR",
            unitPrice: 750,
            vatRate: 20,
            price: 1500,
            vatAmount: 300,
            total: 1800,
        },
    ];
    renderItems();
    updateSummary();
    showToast("Örnek fatura ve alıcı verileri dolduruldu.", "info");
}

// Örnek İstisna Faturası (USD / İrlanda / KDV %0) Doldurucu
function fillSampleIstisna(): void {
    (document.getElementById("taxIDOrTRID") as HTMLInputElement).value = "2222222222";
    (document.getElementById("title") as HTMLInputElement).value = "Acme International Ltd";
    (document.getElementById("name") as HTMLInputElement).value = "";
    (document.getElementById("surname") as HTMLInputElement).value = "";
    (document.getElementById("taxOffice") as HTMLInputElement).value = "";
    (document.getElementById("fullAddress") as HTMLInputElement).value = "Grand Canal Dock, Silicon Docks";
    const countryInput = document.getElementById("country") as HTMLInputElement | null;
    if (countryInput) countryInput.value = "İrlanda";

    const invoiceTypeSelect = document.getElementById("invoiceType") as HTMLSelectElement | null;
    if (invoiceTypeSelect) {
        invoiceTypeSelect.value = "ISTISNA";
        invoiceTypeSelect.dispatchEvent(new Event("change"));
    }

    const currencySelect = document.getElementById("currency") as HTMLSelectElement | null;
    if (currencySelect) {
        currencySelect.value = "USD";
        currencySelect.dispatchEvent(new Event("change"));
    }

    const currencyRateInput = document.getElementById("currencyRate") as HTMLInputElement | null;
    if (currencyRateInput) currencyRateInput.value = "49";

    state.items = [
        {
            id: "sample-istisna-1",
            name: "Yazılım Danışmanlık ve Geliştirme (Hizmet İhracı)",
            quantity: 1,
            unitType: "C62",
            unitPrice: 5100,
            vatRate: 0,
            price: 5100,
            vatAmount: 0,
            total: 5100,
        },
    ];
    renderItems();
    updateSummary();
    showToast("Örnek İstisna faturası (USD, %0 KDV, İrlanda) dolduruldu.", "info");
}

// ─── FATURA KOPYALAMA (ÖNCEKİ FATURADAN ALANLARI DOLDURMA) ────────────────

// Yerel hafızaya faturayı kaydet
function saveInvoiceToCache(uuid: string, payload: InvoicePayload): void {
    if (!uuid) return;
    try {
        const data = { ...payload, uuid, savedAt: new Date().toISOString() };
        localStorage.setItem(`gib_invoice_${uuid}`, JSON.stringify(data));
        localStorage.setItem("gib_last_invoice", JSON.stringify(data));
    } catch (e) {
        console.warn("[saveInvoiceToCache] Önbelleğe kaydedilemedi:", e);
    }
}

// GİB Fatura HTML İçeriğini Ayrıştır
function parseGibInvoiceHtml(html: string): Record<string, unknown> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const result: Record<string, unknown> = {
        items: [] as Array<Record<string, unknown>>,
    };

    // 1. QR Kod Div içindeki Hazır JSON'ı Çek (En temiz ve kesin veri kaynağı)
    const qrDiv = doc.getElementById("qrvalue");
    if (qrDiv) {
        try {
            const rawQr = qrDiv.textContent?.trim() || "";
            const qrJson = JSON.parse(rawQr);
            if (qrJson.tip) result.invoiceType = qrJson.tip;
            if (qrJson.avkntckn) result.taxIDOrTRID = qrJson.avkntckn.trim();
            if (qrJson.parabirimi) result.currency = qrJson.parabirimi.trim();
        } catch (e) {
            console.warn("[parseGibInvoiceHtml] QR JSON ayrıştırma hatası:", e);
        }
    }

    // 2. Fatura Tipi (Eğer QR'dan gelmediyse despatchTable veya başlıktan)
    if (!result.invoiceType) {
        const despatchTable = doc.getElementById("despatchTable");
        if (despatchTable) {
            const dText = despatchTable.textContent || "";
            const tipMatch = dText.match(/Fatura\s*Tipi\s*:\s*([A-ZÇĞİÖŞÜ]+)/i);
            if (tipMatch) result.invoiceType = tipMatch[1].trim();
        }
    }
    if (!result.invoiceType) {
        const fullText = doc.body.textContent || "";
        if (/İSTİSNA|ISTISNA/i.test(fullText)) result.invoiceType = "ISTISNA";
        else if (/TEVKİFAT|TEVKIFAT/i.test(fullText)) result.invoiceType = "TEVKIFAT";
        else if (/İADE|IADE/i.test(fullText)) result.invoiceType = "IADE";
        else result.invoiceType = "SATIS";
    }

    // 3. Alıcı Bilgileri (Unvan, Adres, VKN, Vergi Dairesi)
    // A) Doğrudan Regex ile SAYIN tablosunu ayıkla (iç içe table/tr yapılarından ve DOMParser farklarından etkilenmez)
    const sayinRegex = html.match(/SAYIN[\s\S]*?<\/tr>[\s\S]*?<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>[\s\S]*?<tr>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
    if (sayinRegex) {
        const rawTitle = sayinRegex[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
        if (rawTitle && rawTitle.toUpperCase() !== "SAYIN") {
            result.title = rawTitle;
        }

        const rawAddr = sayinRegex[2]
            .replace(/&rsquo;/g, "'")
            .replace(/&nbsp;/g, " ")
            .replace(/<br\s*\/?>/gi, ", ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        let country = "Türkiye";
        const countryMatch = rawAddr.match(/(?:,\s*|\/\s*)([A-Za-zÇĞİÖŞÜçğıöşü\s]+)$/);
        if (countryMatch && countryMatch[1].trim() !== "Türkiye") {
            country = countryMatch[1].trim();
        }

        const cleanAddress = rawAddr
            .replace(/\b(?:Bina\s*Adı|No|Kapı\s*No|Daire\s*No|Kasaba|Köy|Semt|İlçe)\s*:\s*/gi, "")
            .replace(/\/\s*[A-Za-zÇĞİÖŞÜçğıöşü\s]+$/, "")
            .replace(/[,\s/]+$/, "")
            .trim();

        if (cleanAddress) {
            result.fullAddress = cleanAddress;
            result.country = country;
        }
    }

    // B) DOM ile kontrol ve VKN / Vergi Dairesi ayıklama
    const custTable = doc.getElementById("customerPartyTable");
    if (custTable) {
        // Eğer regex ile bulunamadıysa DOM içindeki hücreleri kontrol et
        if (!result.title || !result.fullAddress) {
            const tds = Array.from(custTable.querySelectorAll("td"));
            const sayinTdIdx = tds.findIndex(td => (td.textContent || "").trim().toUpperCase() === "SAYIN");
            if (sayinTdIdx !== -1) {
                if (!result.title && tds[sayinTdIdx + 1]) {
                    result.title = tds[sayinTdIdx + 1].textContent?.replace(/&nbsp;/g, " ").trim() || "";
                }
                if (!result.fullAddress && tds[sayinTdIdx + 2]) {
                    const rawAddr = tds[sayinTdIdx + 2].innerHTML || "";
                    const clean = rawAddr
                        .replace(/&rsquo;/g, "'")
                        .replace(/&nbsp;/g, " ")
                        .replace(/<br\s*\/?>/gi, ", ")
                        .replace(/<[^>]+>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim();

                    let country = "Türkiye";
                    const countryMatch = clean.match(/(?:,\s*|\/\s*)([A-Za-zÇĞİÖŞÜçğıöşü\s]+)$/);
                    if (countryMatch && countryMatch[1].trim() !== "Türkiye") {
                        country = countryMatch[1].trim();
                    }

                    const cleanAddress = clean
                        .replace(/\b(?:Bina\s*Adı|No|Kapı\s*No|Daire\s*No|Kasaba|Köy|Semt|İlçe)\s*:\s*/gi, "")
                        .replace(/\/\s*[A-Za-zÇĞİÖŞÜçğıöşü\s]+$/, "")
                        .replace(/[,\s/]+$/, "")
                        .trim();

                    result.fullAddress = cleanAddress;
                    result.country = country;
                }
            }
        }

        const custText = custTable.textContent || "";
        const vknMatch = custText.match(/(?:VKN|TCKN)\s*:\s*(\d{10,11})/i);
        if (vknMatch && !result.taxIDOrTRID) {
            result.taxIDOrTRID = vknMatch[1];
        }

        const vdMatch = custText.match(/Vergi\s*Dairesi\s*:\s*([^\n\r<,]+)/i);
        if (vdMatch) {
            result.taxOffice = vdMatch[1].trim();
        }
    }

    // 4. Mal / Hizmet Kalemleri (#lineTable)
    const lineTable = doc.getElementById("lineTable") || doc.querySelector("table.lineTable");
    if (lineTable) {
        const trs = Array.from(lineTable.querySelectorAll("tr"));
        let colName = 1, colQty = 2, colPrice = 3, colVat = 7;
        if (trs.length > 0) {
            const headerCells = Array.from(trs[0].querySelectorAll("td, th")).map(c => (c.textContent || "").toLowerCase().trim());
            headerCells.forEach((h, idx) => {
                // Sadece Mal/Hizmet adı sütununu seç (Tutar, Fiyat ve Oran sütunlarını hariç tut!)
                if ((h.includes("mal") || h.includes("hizmet") || h.includes("açıklama") || h.includes("urun")) && !h.includes("tutar") && !h.includes("fiyat") && !h.includes("oran")) {
                    colName = idx;
                }
                else if (h.includes("miktar")) {
                    colQty = idx;
                }
                else if ((h.includes("birim fiyat") || h.includes("fiyat")) && !h.includes("toplam") && !h.includes("tutar")) {
                    colPrice = idx;
                }
                else if (h.includes("kdv") && h.includes("oran")) {
                    colVat = idx;
                }
            });
        }

        for (let i = 1; i < trs.length; i++) {
            const tds = Array.from(trs[i].querySelectorAll("td"));
            if (tds.length <= colName) continue;

            const name = tds[colName]?.textContent?.replace(/\u00a0/g, " ").trim() || "";
            if (!name || name === "-" || name === " ") continue;

            const rawQtyText = tds[colQty]?.textContent?.replace(/\u00a0/g, " ").trim() || "1 Adet";
            const qtyNumMatch = rawQtyText.replace(/\./g, "").replace(",", ".").match(/\d+(?:\.\d+)?/);
            const quantity = qtyNumMatch ? parseFloat(qtyNumMatch[0]) : 1;

            let unitType = "C62";
            const qLower = rawQtyText.toLowerCase();
            if (qLower.includes("saat") || qLower.includes("hur")) unitType = "HUR";
            else if (qLower.includes("gün") || qLower.includes("day")) unitType = "DAY";
            else if (qLower.includes("ay") || qLower.includes("mon")) unitType = "MON";
            else if (qLower.includes("kg") || qLower.includes("kilo")) unitType = "KGM";
            else if (qLower.includes("metre") || qLower.includes("mtr")) unitType = "MTR";
            else if (qLower.includes("paket") || qLower.includes("pa")) unitType = "PA";

            const rawPriceText = tds[colPrice]?.textContent?.replace(/\u00a0/g, " ").trim() || "0";
            const priceClean = rawPriceText.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
            const unitPrice = parseFloat(priceClean) || 0;

            const rawVatText = tds[colVat]?.textContent?.replace(/\u00a0/g, " ").trim() || "0";
            const vatDigits = rawVatText.replace(/[^\d]/g, "");
            const vatRate = parseInt(vatDigits, 10) || 0;

            if (!result.currency) {
                if (rawPriceText.includes("USD") || rawPriceText.includes("$")) result.currency = "USD";
                else if (rawPriceText.includes("EUR") || rawPriceText.includes("€")) result.currency = "EUR";
                else if (rawPriceText.includes("GBP") || rawPriceText.includes("£")) result.currency = "GBP";
                else if (rawPriceText.includes("TL") || rawPriceText.includes("TRY") || rawPriceText.includes("₺")) result.currency = "TRY";
            }

            (result.items as Array<Record<string, unknown>>).push({
                name,
                quantity,
                unitType,
                unitPrice,
                vatRate,
            });
        }
    }

    // 5. Döviz Kuru (#budgetContainerTable)
    if (result.currency && result.currency !== "TRY") {
        const budgetTable = doc.getElementById("budgetContainerTable");
        if (budgetTable) {
            const bText = budgetTable.innerHTML;
            const tlMatch = bText.match(/(?:Mal\s*Hizmet\s*Toplam\s*Tutarı|Ödenecek\s*Tutar)\s*\(TL\)[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
            const foreignMatch = bText.match(/(?:Mal\s*Hizmet\s*Toplam\s*Tutarı|Ödenecek\s*Tutar)[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);

            if (tlMatch && foreignMatch) {
                const cleanTl = tlMatch[1].replace(/&nbsp;/g, "").replace(/<[^>]+>/g, "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
                const cleanForeign = foreignMatch[1].replace(/&nbsp;/g, "").replace(/<[^>]+>/g, "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
                const numTl = parseFloat(cleanTl);
                const numForeign = parseFloat(cleanForeign);
                if (numTl > 0 && numForeign > 0) {
                    const rate = numTl / numForeign;
                    result.currencyRate = rate.toFixed(4).replace(/\.?0+$/, "");
                }
            }
        }
    }

    console.log("[parseGibInvoiceHtml] GİB HTML'inden ayıklanan veriler:", result);
    return result;
}

// Fatura Bilgilerini Yeni Fatura Formuna Doldur
function applyInvoicePayloadToForm(raw: Record<string, unknown>): void {
    if (!raw) return;

    // Alıcı Bilgileri
    const taxIDOrTRID = String(raw.taxIDOrTRID || raw.vknTckn || raw.aliciVknTckn || "").trim();
    const title = String(raw.title || raw.aliciUnvan || raw.aliciUnvanAdSoyad || "").trim();
    const name = String(raw.name || raw.aliciAdi || "").trim();
    const surname = String(raw.surname || raw.aliciSoyadi || "").trim();
    const taxOffice = String(raw.taxOffice || raw.vergiDairesi || "").trim();
    const fullAddress = String(raw.fullAddress || raw.bulvarcaddesokak || "").trim();
    const country = String(raw.country || raw.ulke || "Türkiye").trim();

    const taxInput = document.getElementById("taxIDOrTRID") as HTMLInputElement;
    const titleInput = document.getElementById("title") as HTMLInputElement;
    const nameInput = document.getElementById("name") as HTMLInputElement;
    const surnameInput = document.getElementById("surname") as HTMLInputElement;
    const taxOfficeInput = document.getElementById("taxOffice") as HTMLInputElement;
    const addressInput = document.getElementById("fullAddress") as HTMLInputElement;
    const countryInput = document.getElementById("country") as HTMLInputElement;

    if (taxInput) taxInput.value = taxIDOrTRID;
    if (titleInput) titleInput.value = title;
    if (nameInput) nameInput.value = name;
    if (surnameInput) surnameInput.value = surname;
    if (taxOfficeInput) taxOfficeInput.value = taxOffice;
    if (addressInput) addressInput.value = fullAddress;
    if (countryInput) countryInput.value = country || "Türkiye";

    // Fatura Tipi
    const invoiceType = String(raw.invoiceType || raw.faturaTipi || "SATIS");
    const invoiceTypeSelect = document.getElementById("invoiceType") as HTMLSelectElement | null;
    if (invoiceTypeSelect) {
        invoiceTypeSelect.value = invoiceType;
        invoiceTypeSelect.dispatchEvent(new Event("change"));
    }

    // Para Birimi ve Kur
    const currency = String(raw.currency || raw.paraBirimi || "TRY");
    const currencyRate = String(raw.currencyRate || raw.dovzTLkur || "");
    const currencySelect = document.getElementById("currency") as HTMLSelectElement | null;
    if (currencySelect) {
        currencySelect.value = currency;
        currencySelect.dispatchEvent(new Event("change"));
    }
    const currencyRateInput = document.getElementById("currencyRate") as HTMLInputElement | null;
    if (currencyRateInput && currencyRate) {
        currencyRateInput.value = currencyRate;
    }

    // Fatura Tarihi ve Saati: Yeni fatura BUGÜN tarihli ve ŞU ANKİ saatli olarak açılır
    const dateInput = document.getElementById("invoiceDate") as HTMLInputElement;
    const timeInput = document.getElementById("invoiceTime") as HTMLInputElement;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    if (dateInput) dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (timeInput) timeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Kalemler (items veya malHizmetTable)
    const rawItems = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.malHizmetTable) ? raw.malHizmetTable : [];
    state.items = [];

    if (rawItems.length > 0) {
        rawItems.forEach((item: Record<string, unknown>) => {
            const itemName = String(item.name || item.malHizmet || "Mal / Hizmet Tanımı");
            const qty = Number(item.quantity ?? item.miktar ?? 1) || 1;
            const unit = String(item.unitType || item.birim || "C62");
            const price = Number(item.unitPrice ?? item.birimFiyat ?? item.fiyat ?? 0) || 0;
            const vat = Number(item.vatRate ?? item.VATRate ?? item.kdvOrani ?? 0) || 0;

            addItem({
                name: itemName,
                quantity: qty,
                unitType: unit,
                unitPrice: price,
                vatRate: vat,
            });
        });
    } else {
        addItem({
            name: "Hizmet / Danışmanlık",
            quantity: 1,
            unitPrice: 0,
            vatRate: invoiceType === "ISTISNA" ? 0 : 20,
        });
    }

    renderItems();
    updateSummary();

    // "Yeni Fatura Kes" sekmesine geç ve en üste kaydır
    const tabBtn = document.getElementById("tab-create-btn") as HTMLButtonElement | null;
    if (tabBtn) tabBtn.click();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// Belirli bir faturayı kopyala (ETTN/UUID ile)
async function cloneInvoice(uuid: string): Promise<void> {
    if (!uuid || uuid === "-") {
        showToast("Geçersiz fatura numarası.", "warning");
        return;
    }

    const inv = state.invoices.find((i) => (i.ettn || i.uuid) === uuid);

    // 1. Önce doğrudan GİB'den HTML çekip en güncel ve eksiksiz verileri ayrıştır
    if (state.token) {
        showToast("Fatura detayları GİB'den alınıyor...", "info");
        try {
            const client = getGibClient(state.env);
            const isSigned = inv?.onayDurumu === "Onaylandı";
            const html = await client.getInvoiceHTML(state.token, uuid, isSigned);
            if (html) {
                const parsed = parseGibInvoiceHtml(html);
                if (inv) {
                    if (!parsed.taxIDOrTRID && (inv.aliciVknTckn || inv.vknTckn)) {
                        parsed.taxIDOrTRID = String(inv.aliciVknTckn || inv.vknTckn);
                    }
                    if (!parsed.title && (inv.aliciUnvanAdSoyad || inv.aliciUnvan)) {
                        parsed.title = String(inv.aliciUnvanAdSoyad || inv.aliciUnvan);
                    }
                }
                applyInvoicePayloadToForm(parsed);
                try {
                    localStorage.setItem(`gib_invoice_${uuid}`, JSON.stringify(parsed));
                } catch {}
                showToast("Fatura bilgileri ve kalemleri yeni fatura formuna kopyalandı!", "success");
                return;
            }
        } catch (e) {
            console.warn("[cloneInvoice] HTML parse hatası:", e);
        }
    }

    // 2. GİB'den çekilemediyse yerel hafızadaki eksiksiz kaydı dene
    const cachedStr = localStorage.getItem(`gib_invoice_${uuid}`);
    if (cachedStr) {
        try {
            const cached = JSON.parse(cachedStr) as Record<string, unknown>;
            if (cached.fullAddress && Array.isArray(cached.items) && cached.items.length > 0) {
                applyInvoicePayloadToForm(cached);
                showToast("Fatura detayları yerel hafızadan yeni fatura formuna aktarıldı!", "success");
                return;
            }
        } catch {}
    }

    // 4. HTML alınamadıysa listedeki temel bilgileri aktar
    if (inv) {
        applyInvoicePayloadToForm(inv);
        const vkn = String(inv.aliciVknTckn || inv.vknTckn || "");
        if (vkn && state.token) {
            handleFetchRecipient();
        }
        showToast("Alıcı bilgileri aktarıldı. Lütfen kalem ve tutar bilgilerini kontrol ediniz.", "info");
        return;
    }

    showToast("Fatura bilgileri bulunamadı.", "warning");
}

// En son faturayı kopyala
function cloneLatestInvoice(): void {
    const lastSaved = localStorage.getItem("gib_last_invoice");
    if (lastSaved) {
        try {
            const parsed = JSON.parse(lastSaved) as Record<string, unknown>;
            if (parsed.fullAddress && Array.isArray(parsed.items) && parsed.items.length > 0) {
                applyInvoicePayloadToForm(parsed);
                showToast("En son oluşturulan fatura bilgileri forma aktarıldı!", "success");
                return;
            }
        } catch {}
    }

    if (state.invoices.length > 0) {
        const first = state.invoices[0];
        const uuid = String(first.ettn || first.uuid || "");
        if (uuid && uuid !== "-") {
            cloneInvoice(uuid);
            return;
        }
    }

    showToast("Kopyalanacak önceki fatura bulunamadı. Lütfen önce 'Faturalar' sekmesinden listeleyiniz.", "warning");
}

// ─── BAŞLANGIÇ & DİNLEYİCİLER ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    initDateFields();
    updateSessionUI();

    // İlk varsayılan boş satırı ekle
    if (state.items.length === 0) {
        addItem({ name: "Danışmanlık Hizmeti", quantity: 1, unitPrice: 1000, vatRate: 20 });
    }

    // Para Birimi Değişimi Dinleyicisi
    const currencySelect = document.getElementById("currency") as HTMLSelectElement | null;
    const currencyRateGroup = document.getElementById("currencyRateGroup");
    if (currencySelect) {
        currencySelect.addEventListener("change", () => {
            const isForeign = currencySelect.value !== "TRY";
            if (currencyRateGroup) {
                if (isForeign) currencyRateGroup.classList.remove("d-none");
                else currencyRateGroup.classList.add("d-none");
            }
            renderItems();
            updateSummary();
        });
    }

    // Fatura Tipi Değişimi Dinleyicisi (İstisna vb.)
    const invoiceTypeSelect = document.getElementById("invoiceType") as HTMLSelectElement | null;
    const istisnaNotice = document.getElementById("istisnaNotice");
    if (invoiceTypeSelect) {
        invoiceTypeSelect.addEventListener("change", () => {
            const isIstisna = invoiceTypeSelect.value === "ISTISNA";
            if (istisnaNotice) {
                if (isIstisna) istisnaNotice.classList.remove("d-none");
                else istisnaNotice.classList.add("d-none");
            }
            if (isIstisna) {
                // İstisna faturasında KDV genelde %0 uygulanır
                state.items.forEach((it) => {
                    it.vatRate = 0;
                    calculateItem(it);
                });
                renderItems();
                updateSummary();
            }
        });
    }

    // Giriş Formu
    const loginForm = document.getElementById("loginForm");
    if (loginForm) loginForm.addEventListener("submit", handleLogin);

    // Satır Ekle Butonu
    const btnAddItem = document.getElementById("btnAddItem");
    if (btnAddItem) btnAddItem.addEventListener("click", () => addItem());

    // Örnek Doldur Butonları
    const btnSample = document.getElementById("btnFillSampleData");
    if (btnSample) btnSample.addEventListener("click", fillSampleData);

    const btnSampleIstisna = document.getElementById("btnFillSampleIstisna");
    if (btnSampleIstisna) btnSampleIstisna.addEventListener("click", fillSampleIstisna);

    // Önceki Faturadan Kopyala Butonu (Form üzerindeki)
    const btnCopyPrev = document.getElementById("btnCopyFromPreviousInvoice");
    if (btnCopyPrev) {
        btnCopyPrev.addEventListener("click", () => {
            cloneLatestInvoice();
        });
    }

    // Önizleme Modalından Kopyala Butonu
    const btnClonePreview = document.getElementById("btnCloneFromPreview");
    if (btnClonePreview) {
        btnClonePreview.addEventListener("click", () => {
            if (state.currentPreviewUuid) {
                const previewModalEl = document.getElementById("previewModal");
                const modal = bootstrap.Modal.getInstance(previewModalEl);
                if (modal) modal.hide();
                cloneInvoice(state.currentPreviewUuid);
            }
        });
    }

    // JSON Modalından Forma Aktar Butonu
    const btnCloneJson = document.getElementById("btnCloneFromJsonModal");
    if (btnCloneJson) {
        btnCloneJson.addEventListener("click", () => {
            const pre = document.getElementById("jsonModalContent");
            if (pre && pre.textContent) {
                try {
                    const data = JSON.parse(pre.textContent);
                    applyInvoicePayloadToForm(data);
                    const jsonModalEl = document.getElementById("jsonModal");
                    const modal = bootstrap.Modal.getInstance(jsonModalEl);
                    if (modal) modal.hide();
                    showToast("JSON verisi yeni fatura formuna aktarıldı!", "success");
                } catch {
                    showToast("JSON verisi ayrıştırılamadı.", "warning");
                }
            }
        });
    }

    // Taslak Bilgi Modalından Kopyala Butonu
    const btnCloneDraft = document.getElementById("btnCloneFromDraftModal");
    if (btnCloneDraft) {
        btnCloneDraft.addEventListener("click", () => {
            if (state.currentDraftDetailItem) {
                const uuid = String(state.currentDraftDetailItem.ettn || state.currentDraftDetailItem.uuid || "");
                const draftModalEl = document.getElementById("draftDetailModal");
                const modal = bootstrap.Modal.getInstance(draftModalEl);
                if (modal) modal.hide();
                if (uuid && uuid !== "-") {
                    cloneInvoice(uuid);
                } else {
                    applyInvoicePayloadToForm(state.currentDraftDetailItem);
                }
            }
        });
    }

    // Alıcı Getir Butonu
    const btnFetchRecipient = document.getElementById("btnFetchRecipient");
    if (btnFetchRecipient) btnFetchRecipient.addEventListener("click", handleFetchRecipient);

    // VKN Hızlı Seçim Butonları
    const btnQuickNihai = document.getElementById("btnQuickNihaiTuketici");
    if (btnQuickNihai) {
        btnQuickNihai.addEventListener("click", () => {
            const taxInput = document.getElementById("taxIDOrTRID") as HTMLInputElement;
            const titleInput = document.getElementById("title") as HTMLInputElement;
            const nameInput = document.getElementById("name") as HTMLInputElement;
            const surnameInput = document.getElementById("surname") as HTMLInputElement;
            const countryInput = document.getElementById("country") as HTMLInputElement;
            if (taxInput) taxInput.value = "11111111111";
            if (titleInput) titleInput.value = "Nihai Tüketici";
            if (nameInput) nameInput.value = "Nihai";
            if (surnameInput) surnameInput.value = "Tüketici";
            if (countryInput) countryInput.value = "Türkiye";
            showToast("Nihai Tüketici (11111111111) bilgileri dolduruldu.", "info");
        });
    }

    const btnQuickYurtdisi = document.getElementById("btnQuickYurtdisi");
    if (btnQuickYurtdisi) {
        btnQuickYurtdisi.addEventListener("click", () => {
            const taxInput = document.getElementById("taxIDOrTRID") as HTMLInputElement;
            const invoiceType = document.getElementById("invoiceType") as HTMLSelectElement;
            const currency = document.getElementById("currency") as HTMLSelectElement;
            if (taxInput) taxInput.value = "2222222222";
            if (invoiceType) {
                invoiceType.value = "ISTISNA";
                invoiceType.dispatchEvent(new Event("change"));
            }
            if (currency) {
                currency.value = "USD";
                currency.dispatchEvent(new Event("change"));
            }
            showToast("Yurtdışı Müşteri (2222222222) ve İstisna faturası seçildi.", "info");
        });
    }

    // Fatura Oluştur Butonları
    const btnDraft = document.getElementById("btnCreateDraft");
    if (btnDraft) btnDraft.addEventListener("click", () => handleCreateInvoice(false));

    const btnSign = document.getElementById("btnCreateAndSign");
    if (btnSign) btnSign.addEventListener("click", () => handleCreateInvoice(true));

    // Önizleme Butonu (Yerel Taslak Önizleme)
    const btnPreview = document.getElementById("btnPreviewInvoice") as HTMLButtonElement | null;
    if (btnPreview) {
        btnPreview.addEventListener("click", () => {
            const payload = getInvoicePayload();
            if (!payload) return;
            showLocalInvoicePreview(payload);
        });
    }

    // JSON Kopyala Butonu (Modal içi)
    const btnCopyJson = document.getElementById("btnCopyJson");
    if (btnCopyJson) {
        btnCopyJson.addEventListener("click", () => {
            const pre = document.getElementById("jsonModalContent");
            if (pre && pre.textContent) {
                navigator.clipboard.writeText(pre.textContent).then(() => {
                    showToast("JSON panoya kopyalandı!", "info");
                });
            }
        });
    }

    // Yazdır Butonu
    const btnPrint = document.getElementById("btnPrintPreview");
    if (btnPrint) {
        btnPrint.addEventListener("click", () => {
            const iframe = document.getElementById("previewIframe") as HTMLIFrameElement;
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            }
        });
    }

    // Modal İçinden PDF İndir Butonu
    const btnDownloadPdfModal = document.getElementById("btnDownloadPdfFromPreview");
    if (btnDownloadPdfModal) {
        btnDownloadPdfModal.addEventListener("click", async () => {
            await downloadCurrentPreviewPdf();
        });
    }

    // Modal İçinden Yeni Sekmede Aç Butonu
    const btnOpenNewTabModal = document.getElementById("btnOpenInNewTab");
    if (btnOpenNewTabModal) {
        btnOpenNewTabModal.addEventListener("click", () => {
            openPreviewInNewTab();
        });
    }

    // Modal İçinden Tam Ekran Değiştir Butonu
    const btnFullscreenModal = document.getElementById("btnToggleFullscreenPreview");
    if (btnFullscreenModal) {
        btnFullscreenModal.addEventListener("click", () => {
            toggleFullscreenPreview();
        });
    }

    // İndir Butonu (Önizleme içinden ZIP)
    const btnDownloadModal = document.getElementById("btnDownloadFromPreview");
    if (btnDownloadModal) {
        btnDownloadModal.addEventListener("click", () => {
            if (state.currentPreviewUuid && state.token) {
                const client = getGibClient(state.env);
                const zipUrl = client.getDownloadURL(state.token, state.currentPreviewUuid, state.currentPreviewSigned);
                window.open(zipUrl, "_blank");
            }
        });
    }

    // Faturaları Listele Butonu
    const btnList = document.getElementById("btnListInvoices");
    if (btnList) btnList.addEventListener("click", () => handleListInvoices());

    // Tarih alanları elle değiştirildiğinde kısıtları uygula, bitiş tarihini otomatik ayarla ve buton vurgusunu temizle
    const filterStartInput = document.getElementById("filterStartDate");
    const filterEndInput = document.getElementById("filterEndDate");
    if (filterStartInput) {
        filterStartInput.addEventListener("change", () => {
            syncDateInputsConstraint("start");
            setQuickDateActiveButton(null);
        });
    }
    if (filterEndInput) {
        filterEndInput.addEventListener("change", () => {
            syncDateInputsConstraint("end");
            setQuickDateActiveButton(null);
        });
    }

    // Hızlı Bugün Butonu
    const btnToday = document.getElementById("btnQuickDateToday");
    if (btnToday) {
        btnToday.addEventListener("click", () => applyQuickDateFilter("today", "btnQuickDateToday"));
    }

    // Hızlı Dün Butonu
    const btnYesterday = document.getElementById("btnQuickDateYesterday");
    if (btnYesterday) {
        btnYesterday.addEventListener("click", () => applyQuickDateFilter("yesterday", "btnQuickDateYesterday"));
    }

    // Hızlı Son 3 Gün Butonu
    const btn3Days = document.getElementById("btnQuickDate3Days");
    if (btn3Days) {
        btn3Days.addEventListener("click", () => applyQuickDateFilter(3, "btnQuickDate3Days"));
    }

    // Hızlı Son 7 Gün Butonu
    const btn7Days = document.getElementById("btnQuickDate7Days");
    if (btn7Days) {
        btn7Days.addEventListener("click", () => applyQuickDateFilter(7, "btnQuickDate7Days"));
    }

    // Fatura Listesinde Canlı Arama ve Temizle Butonu (Debounced)
    const invoiceSearch = document.getElementById("invoiceSearchInput") as HTMLInputElement | null;
    const btnClearSearch = document.getElementById("btnClearSearch");
    let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    if (invoiceSearch) {
        invoiceSearch.addEventListener("input", () => {
            if (btnClearSearch) {
                btnClearSearch.classList.toggle("d-none", !invoiceSearch.value.trim());
            }
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                renderInvoicesTable();
            }, 120);
        });
    }
    if (btnClearSearch && invoiceSearch) {
        btnClearSearch.addEventListener("click", () => {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            invoiceSearch.value = "";
            btnClearSearch.classList.add("d-none");
            renderInvoicesTable();
            invoiceSearch.focus();
        });
    }

    // Fatura Durum Filtre Butonları (Tümü, Onaylı, Taslak, Silinmiş)
    const statusFilterGroup = document.getElementById("invoiceStatusFilterGroup");
    if (statusFilterGroup) {
        statusFilterGroup.querySelectorAll("button[data-filter]").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                const targetBtn = e.currentTarget as HTMLButtonElement;
                const filterVal = (targetBtn.dataset.filter || "all") as "all" | "signed" | "draft" | "deleted";
                state.invoiceStatusFilter = filterVal;

                // Buton görünümlerini güncelle
                statusFilterGroup.querySelectorAll("button").forEach((b) => {
                    b.classList.remove("active", "btn-primary");
                    b.classList.add("btn-outline-secondary");
                });
                targetBtn.classList.remove("btn-outline-secondary");
                targetBtn.classList.add("active", "btn-primary");

                renderInvoicesTable();
            });
        });
    }

    // Faturaları CSV Olarak Dışa Aktar Butonu
    const btnExportCsv = document.getElementById("btnExportInvoicesCsv");
    if (btnExportCsv) {
        btnExportCsv.addEventListener("click", () => {
            exportInvoicesToCsv();
        });
    }

    // Formu Sıfırla / Temizle Butonu
    const btnResetForm = document.getElementById("btnResetForm");
    if (btnResetForm) {
        btnResetForm.addEventListener("click", () => {
            resetInvoiceForm();
            showToast("Yeni fatura formu temizlendi.", "info");
        });
    }

    // Mükellef Bilgilerini Yenile Butonu
    const btnRefreshUserData = document.getElementById("btnRefreshUserData");
    if (btnRefreshUserData) {
        btnRefreshUserData.addEventListener("click", () => {
            loadUserData();
        });
    }

    // Taslak İptal Onay
    const btnConfirmCancel = document.getElementById("btnConfirmCancel") as HTMLButtonElement | null;
    if (btnConfirmCancel) {
        btnConfirmCancel.addEventListener("click", async () => {
            const reasonInput = document.getElementById("cancelReasonInput") as HTMLInputElement;
            const reason = reasonInput.value.trim();
            if (!reason) {
                showToast("Lütfen iptal gerekçesini yazınız.", "warning");
                return;
            }
            if (!state.selectedDraftForCancel || !state.token) return;

            btnConfirmCancel.disabled = true;
            try {
                const client = getGibClient(state.env);
                await client.cancelDraftInvoice(state.token, reason, state.selectedDraftForCancel);
                showToast("Taslak fatura iptal edildi.", "success");

                const cancelModalEl = document.getElementById("cancelModal");
                const modal = bootstrap.Modal.getInstance(cancelModalEl);
                if (modal) modal.hide();

                handleListInvoices();
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                showToast(`İptal Hatası: ${msg}`, "danger");
            } finally {
                btnConfirmCancel.disabled = false;
            }
        });
    }

    // Test Ortamına Geçiş Butonu
    const btnSwitchToTest = document.getElementById("btnSwitchToTest");
    if (btnSwitchToTest) {
        btnSwitchToTest.addEventListener("click", () => {
            state.env = "TEST";
            sessionStorage.setItem("gib_env", "TEST");
            updateSessionUI();
            showToast("Ortam TEST olarak değiştirildi.", "info");
        });
    }

    // Mükellef Bilgileri sekmesi seçildiğinde verileri yükle/yenile
    const tabUserBtn = document.getElementById("tab-user-btn");
    if (tabUserBtn) {
        tabUserBtn.addEventListener("click", () => {
            loadUserData();
        });
    }

    // Şifre Göster / Gizle Butonu
    const btnTogglePassword = document.getElementById("btnTogglePassword");
    const loginPasswordInput = document.getElementById("loginPassword") as HTMLInputElement | null;
    const passwordToggleIcon = document.getElementById("passwordToggleIcon");
    if (btnTogglePassword && loginPasswordInput && passwordToggleIcon) {
        btnTogglePassword.addEventListener("click", () => {
            const isPassword = loginPasswordInput.type === "password";
            loginPasswordInput.type = isPassword ? "text" : "password";
            passwordToggleIcon.className = isPassword ? "bi bi-eye-slash text-primary" : "bi bi-eye";
        });
    }

    // Giriş modalındaki kullanıcı kodunu otomatik doldur (eğer daha önce girilmişse)
    const loginUserInput = document.getElementById("loginUsername") as HTMLInputElement | null;
    const rememberMeCheck = document.getElementById("rememberMeCheck") as HTMLInputElement | null;
    const rememberedUserCode = localStorage.getItem("gib_last_username") || localStorage.getItem("gib_user_code") || sessionStorage.getItem("gib_user_code");

    if (loginUserInput && !loginUserInput.value && rememberedUserCode) {
        loginUserInput.value = rememberedUserCode;
    }
    if (rememberMeCheck) {
        rememberMeCheck.checked = Boolean(localStorage.getItem("gib_user_code") || localStorage.getItem("gib_last_username") || !rememberedUserCode);
    }

    // Eğer önceden oturum açıksa kullanıcı verilerini yükle
    if (state.token) {
        loadUserData();
    }

    // --- CANLI İŞLEM LOGLARI TAKİBİ ---
    initLogStream();
});

let totalLogCount = 0;
let clientLogCounter = 0;

export function logApp(
    level: LogLevel,
    category: LogCategory,
    message: string,
    details?: unknown
): void {
    const entry = {
        id: ++clientLogCounter,
        timestamp: new Date().toLocaleTimeString("tr-TR", { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0"),
        level,
        category,
        message,
        details,
    };
    appendLogEntry(entry);
    const prefix = `[${entry.timestamp}] [${level}] [${category}]`;
    if (level === "ERROR") console.error(`${prefix} ${message}`, details !== undefined ? details : "");
    else if (level === "WARN") console.warn(`${prefix} ${message}`, details !== undefined ? details : "");
    else console.log(`${prefix} ${message}`, details !== undefined ? details : "");
}

function appendLogEntry(entry: { id: number; timestamp: string; level: string; category: string; message: string; details?: unknown }): void {
    if (!entry || !entry.message) return;
    totalLogCount++;

    const badge = document.getElementById("logCountBadge");
    if (badge) badge.textContent = String(totalLogCount);

    const placeholder = document.getElementById("emptyLogsPlaceholder");
    if (placeholder) placeholder.style.display = "none";

    const list = document.getElementById("logsList");
    if (!list) return;

    let levelColor = "#22c55e"; // INFO green
    if (entry.level === "WARN") levelColor = "#eab308"; // yellow
    if (entry.level === "ERROR") levelColor = "#ef4444"; // red
    if (entry.level === "DEBUG") levelColor = "#06b6d4"; // cyan

    const div = document.createElement("div");
    div.className = "py-1 border-bottom border-dark font-monospace";
    div.innerHTML = `
        <span class="text-secondary">[${entry.timestamp}]</span>
        <span class="badge px-1 py-0 me-1" style="background-color: ${levelColor}; color: #000; font-size: 0.7rem;">${entry.level}</span>
        <span class="badge bg-secondary px-1 py-0 me-1" style="font-size: 0.7rem;">${entry.category}</span>
        <span>${escapeHtml(entry.message)}</span>
        ${entry.details ? `<div class="text-white-50 ms-3 mt-1 user-select-all" style="font-size: 0.75rem;">${escapeHtml(typeof entry.details === "object" ? JSON.stringify(entry.details, null, 2) : String(entry.details))}</div>` : ""}
    `;

    list.appendChild(div);

    const autoScroll = (document.getElementById("autoScrollLogs") as HTMLInputElement)?.checked;
    if (autoScroll) {
        const container = document.getElementById("logsContainer");
        if (container) container.scrollTop = container.scrollHeight;
    }
}

function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

function initLogStream(): void {
    logApp("INFO", "SYSTEM", "Better e-Arşiv Fatura istemci uygulaması hazır. (Sunucusuz Mod)");

    // Logları Temizle butonu
    const btnClearLogs = document.getElementById("btnClearLogs");
    if (btnClearLogs) {
        btnClearLogs.addEventListener("click", () => {
            const list = document.getElementById("logsList");
            if (list) list.innerHTML = "";
            totalLogCount = 0;
            const badge = document.getElementById("logCountBadge");
            if (badge) badge.textContent = "0";
            const placeholder = document.getElementById("emptyLogsPlaceholder");
            if (placeholder) placeholder.style.display = "block";
        });
    }
}
