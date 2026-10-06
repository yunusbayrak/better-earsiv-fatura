// e-Arşiv Fatura Arayüzü TypeScript İstemci Mantığı

declare const bootstrap: {
    Modal: {
        new (element: HTMLElement | null): { show(): void; hide(): void };
        getInstance(element: HTMLElement | null): { show(): void; hide(): void } | null;
    };
    Toast: {
        new (element: HTMLElement | null): { show(): void };
    };
};

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
    items: InvoiceItemState[];
    invoices: Array<Record<string, unknown>>;
    selectedDraftForCancel: Record<string, unknown> | null;
    currentPreviewUuid: string | null;
    currentPreviewSigned: boolean;
    currentJsonModalData: unknown | null;
    currentDraftDetailItem: Record<string, unknown> | null;
}

const state: AppState = {
    token: sessionStorage.getItem("gib_token") || null,
    env: (sessionStorage.getItem("gib_env") as "TEST" | "PROD") || "TEST",
    username: sessionStorage.getItem("gib_username") || null,
    items: [],
    invoices: [],
    selectedDraftForCancel: null,
    currentPreviewUuid: null,
    currentPreviewSigned: false,
    currentJsonModalData: null,
    currentDraftDetailItem: null,
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

    toastEl.className = `toast align-items-center text-white border-0 bg-${type}`;
    toastBody.innerText = message;
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}

// Tarih ve saat ilklendirme (Bugün ve Son 5-7 gün filtresi)
function initDateFields(): void {
    const dateInput = document.getElementById("invoiceDate") as HTMLInputElement;
    const timeInput = document.getElementById("invoiceTime") as HTMLInputElement;
    const filterStart = document.getElementById("filterStartDate") as HTMLInputElement;
    const filterEnd = document.getElementById("filterEndDate") as HTMLInputElement;

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // 5 gün öncesini hesaplayalım (Örn: 2026-10-06 için 2026-10-01)
    const past5 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const startStr = `${past5.getFullYear()}-${pad(past5.getMonth() + 1)}-${pad(past5.getDate())}`;

    if (dateInput && !dateInput.value) dateInput.value = dateStr;
    if (timeInput && !timeInput.value) timeInput.value = timeStr;
    if (filterStart && !filterStart.value) filterStart.value = startStr;
    if (filterEnd && !filterEnd.value) filterEnd.value = dateStr;
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
            sessionContainer.innerHTML = `
                <span class="text-light small me-2"><i class="bi bi-person-circle me-1"></i>${state.username || "Kullanıcı"}</span>
                <span class="badge bg-success me-2">Oturum Açık</span>
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

        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ env, username, password }),
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || "Giriş başarısız oldu.");
        }

        state.token = data.token;
        state.env = env;
        state.username = username;
        sessionStorage.setItem("gib_token", data.token);
        sessionStorage.setItem("gib_env", env);
        sessionStorage.setItem("gib_username", username);

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
            await fetch("/api/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ env: state.env, token: state.token }),
            });
        } catch {
            // yut
        }
    }

    // 1. Oturum durumunu sıfırla
    state.token = null;
    state.username = null;
    sessionStorage.removeItem("gib_token");
    sessionStorage.removeItem("gib_username");

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
        const res = await fetch("/api/recipient", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ env: state.env, token: state.token, taxId }),
        });
        const json = await res.json();
        if (!json.success) {
            throw new Error(json.error || "Alıcı sorgulanamadı.");
        }

        const data = json.data?.data || json.data;
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
        const res = await fetch("/api/invoices/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                env: state.env,
                token: state.token,
                invoiceDetails: payload,
                sign,
            }),
        });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || "Fatura oluşturulamadı.");
        }

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
async function previewInvoiceHtml(uuid: string, onayDurumu: string | boolean = "Onaylanmadı"): Promise<void> {
    if (!state.token) {
        showToast("Önizleme için giriş yapmış olmalısınız.", "warning");
        return;
    }

    const onayStr = typeof onayDurumu === "boolean" ? (onayDurumu ? "Onaylandı" : "Onaylanmadı") : onayDurumu;
    const isSigned = onayStr === "Onaylandı";
    state.currentPreviewUuid = uuid;
    state.currentPreviewSigned = isSigned;

    try {
        const res = await fetch("/api/invoices/html", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                env: state.env,
                token: state.token,
                uuid,
                onayDurumu,
            }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "HTML getirilemedi.");

        const iframe = document.getElementById("previewIframe") as HTMLIFrameElement;
        if (iframe) {
            iframe.srcdoc = data.html;
        }

        const modalEl = document.getElementById("previewModal");
        if (modalEl) new bootstrap.Modal(modalEl).show();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Önizleme: ${msg}`, "warning");
        const item = state.invoices.find((i) => (i.ettn || i.uuid) === uuid);
        if (item) {
            showDraftDetailModal(item as Record<string, unknown>);
        }
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

    const [sy, sm, sd] = startVal.split("-");
    const [ey, em, ed] = endVal.split("-");
    const startDate = `${sd}/${sm}/${sy}`;
    const endDate = `${ed}/${em}/${ey}`;

    const btn = document.getElementById("btnListInvoices") as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Listeleniyor...`;

    try {
        const res = await fetch("/api/invoices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                env: state.env,
                token: state.token,
                startDate,
                endDate,
                issuedToMe: typeVal === "incoming",
            }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Faturalar getirilemedi.");

        state.invoices = Array.isArray(json.data) ? json.data : [];
        console.log("[API Faturalar]", state.invoices);
        renderInvoicesTable();
        showToast(`${state.invoices.length} adet fatura listelendi.`, "success");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Listeleme Hatası: ${msg}`, "danger");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-arrow-clockwise me-1"></i> Faturaları Listele`;
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

    const filteredInvoices = query
        ? state.invoices.filter((inv) => {
              const ettn = String(inv.ettn || inv.uuid || "").toLowerCase();
              const belgeNo = String(inv.belgeNumarasi || "").toLowerCase();
              const alici = String(inv.aliciUnvanAdSoyad || inv.aliciUnvan || `${inv.aliciAdi || ""} ${inv.aliciSoyadi || ""}`).toLowerCase();
              const vkn = String(inv.aliciVknTckn || inv.vknTckn || "").toLowerCase();
              return ettn.includes(query) || belgeNo.includes(query) || alici.includes(query) || vkn.includes(query);
          })
        : state.invoices;

    if (badge) {
        badge.textContent = query
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
            statusBadge = `<span class="badge bg-danger"><i class="bi bi-x-circle me-1"></i>Silinmiş</span>`;
        } else if (isSigned) {
            statusBadge = `<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Onaylandı</span>`;
        } else {
            statusBadge = `<span class="badge bg-warning text-dark"><i class="bi bi-clock-history me-1"></i>Taslak</span>`;
        }

        // İşlem Butonları
        let actionButtons = "";
        if (isDeleted) {
            // Silinmiş belgeler tekrar düzenlenemez veya onaylanamaz
            actionButtons = `
                <button class="btn btn-outline-secondary btn-action-view" data-uuid="${ettn}" data-onay="Silinmiş" title="Görüntüle (HTML)">
                    <i class="bi bi-eye"></i>
                </button>
            `;
        } else if (isSigned) {
            actionButtons = `
                <button class="btn btn-outline-primary btn-action-view" data-uuid="${ettn}" data-onay="Onaylandı" title="Görüntüle (HTML)">
                    <i class="bi bi-eye"></i>
                </button>
                <a href="/api/invoices/download?env=${state.env}&token=${state.token}&uuid=${ettn}&signed=true" class="btn btn-outline-secondary" title="ZIP İndir" download>
                    <i class="bi bi-download"></i>
                </a>
            `;
        } else {
            // Aktif taslak (Onaylanmadı): Görüntülenebilir, onaylanabilir, silinebilir
            actionButtons = `
                <button class="btn btn-outline-primary btn-action-view" data-uuid="${ettn}" data-onay="Onaylanmadı" title="Görüntüle (HTML)">
                    <i class="bi bi-eye"></i>
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
                <div class="small text-muted font-monospace mt-1 user-select-all" style="font-size: 0.75rem;" title="${ettn}">
                    ${ettn !== "-" ? ettn : ""}
                </div>
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

    // 2. HTML Önizle Dinleyicisi (Belgenin Mevcut Onay Durumuyla Çeker, İmzalamaz)
    tbody.querySelectorAll(".btn-action-view").forEach((el) => {
        el.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(".btn-action-view") as HTMLElement;
            if (btn && btn.dataset.uuid) {
                previewInvoiceHtml(btn.dataset.uuid, btn.dataset.onay || "Onaylanmadı");
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
                    const res = await fetch("/api/invoices/sign", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ env: state.env, token: state.token, uuid, draftInvoice: inv }),
                    });
                    const d = await res.json();
                    if (!d.success) throw new Error(d.error || "İmzalanamadı.");
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

// Form İçin Yerel Fatura Taslak Önizlemesi
function showLocalInvoicePreview(payload: InvoicePayload): void {
    if (!payload) return;
    const curr = payload.currency || "TRY";
    const rate = payload.currencyRate ? Number(payload.currencyRate) : 0;
    const rateText = curr !== "TRY" && rate > 0 ? ` (Kur: ${rate.toFixed(4)} ₺)` : "";

    const rowsHtml = payload.items.map((item, idx) => `
        <tr>
            <td class="text-center">${idx + 1}</td>
            <td><strong>${item.name}</strong></td>
            <td class="text-center">${item.quantity} ${item.unitType || "C62"}</td>
            <td class="text-end">${Number(item.unitPrice || 0).toFixed(2)} ${curr}</td>
            <td class="text-center">%${item.VATRate || 0}</td>
            <td class="text-end">${Number(item.VATAmount || 0).toFixed(2)} ${curr}</td>
            <td class="text-end fw-bold">${(Number(item.price || 0) + Number(item.VATAmount || 0)).toFixed(2)} ${curr}</td>
        </tr>
    `).join("");

    const previewHtml = `
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #212529; }
                .invoice-box { max-width: 800px; margin: auto; border: 1px solid #dee2e6; border-radius: 8px; padding: 24px; background: #fff; }
                .header-table, .details-table, .items-table, .totals-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                .items-table th, .items-table td { border: 1px solid #dee2e6; padding: 8px 12px; font-size: 13px; }
                .items-table th { background: #f8f9fa; font-weight: 600; }
                .totals-table td { padding: 6px 12px; font-size: 14px; }
                .watermark { position: fixed; top: 40%; left: 20%; transform: rotate(-30deg); font-size: 60px; color: rgba(220, 53, 69, 0.15); font-weight: 900; pointer-events: none; z-index: 1000; }
                .alert-info { background: #e7f1ff; border: 1px solid #b6d4fe; border-radius: 6px; padding: 10px 14px; font-size: 13px; margin-bottom: 20px; color: #084298; }
            </style>
        </head>
        <body>
            <div class="watermark">TASLAK ÖNİZLEME</div>
            <div class="invoice-box">
                <div class="alert-info">
                    ℹ️ <strong>Taslak Yerel Önizleme:</strong> Bu görünüm form verilerinizden oluşturulmuştur. GİB resmi HTML görünümü fatura sisteme kaydedilip onaylandıktan sonra GİB tarafından üretilir.
                </div>
                <table class="header-table">
                    <tr>
                        <td style="width: 50%; vertical-align: top;">
                            <h3 style="margin: 0 0 8px 0; color: #0d6efd;">e-Arşiv Fatura</h3>
                            <div style="font-size: 13px; color: #6c757d;">Fatura Tipi: <strong>${payload.invoiceType || "SATIS"}</strong></div>
                            <div style="font-size: 13px; color: #6c757d;">Para Birimi: <strong>${curr}${rateText}</strong></div>
                        </td>
                        <td style="width: 50%; text-align: right; vertical-align: top; font-size: 13px;">
                            <div>Fatura Tarihi: <strong>${payload.date}</strong></div>
                            <div>Fatura Saati: <strong>${payload.time}</strong></div>
                            <div>Belge No: <span style="background: #e9ecef; padding: 2px 6px; border-radius: 4px; font-family: monospace;">Taslak (Henüz İmzalanmadı)</span></div>
                        </td>
                    </tr>
                </table>

                <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 14px; margin-bottom: 20px; font-size: 13px;">
                    <strong style="color: #495057;">ALICI BİLGİLERİ</strong>
                    <div style="font-size: 15px; font-weight: 700; margin-top: 4px;">${payload.title || `${payload.name || ""} ${payload.surname || ""}`.trim() || "Nihai Tüketici"}</div>
                    <div>VKN / TCKN: <strong>${payload.taxIDOrTRID || "11111111111"}</strong> ${payload.taxOffice ? " | V.D.: " + payload.taxOffice : ""}</div>
                    <div>Adres: ${payload.fullAddress || "-"}</div>
                    <div>Ülke: <strong>${payload.country || "Türkiye"}</strong></div>
                </div>

                <table class="items-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;">Sıra</th>
                            <th>Mal / Hizmet</th>
                            <th style="width: 100px;">Miktar</th>
                            <th style="width: 110px;">Birim Fiyat</th>
                            <th style="width: 80px;">KDV</th>
                            <th style="width: 100px;">KDV Tutarı</th>
                            <th style="width: 120px;">Toplam</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>

                <table style="width: 100%;">
                    <tr>
                        <td style="width: 50%; vertical-align: top;"></td>
                        <td style="width: 50%;">
                            <table class="totals-table" style="border: 1px solid #dee2e6; border-radius: 6px; background: #fafafa;">
                                <tr>
                                    <td>Mal/Hizmet Toplamı:</td>
                                    <td class="text-end fw-semibold">${payload.grandTotal.toFixed(2)} ${curr}</td>
                                </tr>
                                <tr>
                                    <td>Hesaplanan KDV:</td>
                                    <td class="text-end fw-semibold">${payload.totalVAT.toFixed(2)} ${curr}</td>
                                </tr>
                                <tr style="border-top: 2px solid #0d6efd; background: #f0f7ff;">
                                    <td style="font-size: 16px; font-weight: 700; color: #0d6efd;">Ödenecek Tutar:</td>
                                    <td class="text-end" style="font-size: 16px; font-weight: 700; color: #0d6efd;">${payload.paymentTotal.toFixed(2)} ${curr}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </div>
        </body>
        </html>
    `;

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
        const res = await fetch("/api/user-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ env: state.env, token: state.token }),
        });
        const json = await res.json();
        if (json.success && json.data) {
            const u = json.data as Record<string, unknown>;

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

            // Navbar'daki kullanıcı adını da güncelle
            if (displayTitle && displayTitle !== "-") {
                state.username = displayTitle;
                updateSessionUI();
            }

            container.innerHTML = `
                <div class="row g-4">
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-0 fw-semibold">Ünvan / Ad Soyad</label>
                        <div class="fw-bold fs-6 text-dark">${displayTitle}</div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-0 fw-semibold">VKN / TCKN</label>
                        <div class="fw-bold fs-6 text-primary">${taxId}</div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-0 fw-semibold">Vergi Dairesi</label>
                        <div class="text-secondary">${taxOffice}</div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label text-muted small mb-0 fw-semibold">İletişim (Telefon / E-posta)</label>
                        <div class="text-secondary">${contactInfo}</div>
                    </div>
                    <div class="col-12">
                        <label class="form-label text-muted small mb-0 fw-semibold">Mükellef Adresi</label>
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
        } else {
            const err = json.error || "Mükellef bilgileri alınamadı.";
            container.innerHTML = `
                <div class="alert alert-warning mb-0 d-flex justify-content-between align-items-center">
                    <div><i class="bi bi-exclamation-triangle me-2"></i>${err}</div>
                    <button class="btn btn-sm btn-outline-warning" id="btnRetryUserData">Tekrar Dene</button>
                </div>
            `;
            document.getElementById("btnRetryUserData")?.addEventListener("click", () => loadUserData());
        }
    } catch {
        container.innerHTML = `
            <div class="alert alert-danger mb-0 d-flex justify-content-between align-items-center">
                <div><i class="bi bi-exclamation-octagon me-2"></i>Mükellef bilgileri yüklenirken bağlantı hatası oluştu.</div>
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
            const res = await fetch("/api/invoices/html", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    env: state.env,
                    token: state.token,
                    uuid,
                    onayDurumu: inv?.onayDurumu || "Onaylanmadı",
                }),
            });
            const data = await res.json();
            if (data.success && data.html) {
                const parsed = parseGibInvoiceHtml(data.html);
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

    // İndir Butonu (Önizleme içinden)
    const btnDownloadModal = document.getElementById("btnDownloadFromPreview");
    if (btnDownloadModal) {
        btnDownloadModal.addEventListener("click", () => {
            if (state.currentPreviewUuid && state.token) {
                window.location.href = `/api/invoices/download?env=${state.env}&token=${state.token}&uuid=${state.currentPreviewUuid}&signed=${state.currentPreviewSigned}`;
            }
        });
    }

    // Faturaları Listele Butonu
    const btnList = document.getElementById("btnListInvoices");
    if (btnList) btnList.addEventListener("click", handleListInvoices);

    // Hızlı Bugün Butonu
    const btnToday = document.getElementById("btnQuickDateToday");
    if (btnToday) {
        btnToday.addEventListener("click", () => {
            initDateFields();
            handleListInvoices();
        });
    }

    // Hızlı Son 7 Gün Butonu
    const btn7Days = document.getElementById("btnQuickDate7Days");
    if (btn7Days) {
        btn7Days.addEventListener("click", () => {
            const startInput = document.getElementById("filterStartDate") as HTMLInputElement;
            const endInput = document.getElementById("filterEndDate") as HTMLInputElement;
            const now = new Date();
            const past = new Date();
            past.setDate(past.getDate() - 6);

            const pad = (n: number) => n.toString().padStart(2, "0");
            if (endInput) endInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
            if (startInput) startInput.value = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${past.getDate()}`;
            handleListInvoices();
        });
    }

    // Hızlı Bu Ay Butonu
    const btnThisMonth = document.getElementById("btnQuickDateThisMonth");
    if (btnThisMonth) {
        btnThisMonth.addEventListener("click", () => {
            const startInput = document.getElementById("filterStartDate") as HTMLInputElement;
            const endInput = document.getElementById("filterEndDate") as HTMLInputElement;
            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, "0");
            if (endInput) endInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
            if (startInput) startInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
            handleListInvoices();
        });
    }

    // Fatura Listesinde Canlı Arama
    const invoiceSearch = document.getElementById("invoiceSearchInput");
    if (invoiceSearch) {
        invoiceSearch.addEventListener("input", () => {
            renderInvoicesTable();
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
                const res = await fetch("/api/invoices/cancel", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        env: state.env,
                        token: state.token,
                        reason,
                        draftInvoice: state.selectedDraftForCancel,
                    }),
                });
                const d = await res.json();
                if (!d.success) throw new Error(d.error || "İptal edilemedi.");
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

    // Eğer önceden oturum açıksa kullanıcı verilerini yükle
    if (state.token) {
        loadUserData();
    }

    // --- CANLI SUNUCU LOGLARI TAKİBİ ---
    initLogStream();
});

let totalLogCount = 0;

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
    // 1. Önceki logları REST API ile çek
    fetch("/api/logs")
        .then((res) => res.json())
        .then((data) => {
            if (data.success && Array.isArray(data.logs)) {
                data.logs.forEach((log: { id: number; timestamp: string; level: string; category: string; message: string; details?: unknown }) => {
                    appendLogEntry(log);
                });
            }
        })
        .catch(() => {});

    // 2. Server-Sent Events (SSE) ile canlı dinle
    try {
        const eventSource = new EventSource("/api/logs/stream");
        eventSource.onmessage = (event) => {
            try {
                const logData = JSON.parse(event.data);
                appendLogEntry(logData);
            } catch {}
        };
        eventSource.onerror = () => {
            // SSE bağlantı kesildiğinde tarayıcı otomatik yeniden dener
        };
    } catch {}

    // 3. Logları Temizle butonu
    const btnClearLogs = document.getElementById("btnClearLogs");
    if (btnClearLogs) {
        btnClearLogs.addEventListener("click", async () => {
            try {
                await fetch("/api/logs/clear", { method: "POST" });
                const list = document.getElementById("logsList");
                if (list) list.innerHTML = "";
                totalLogCount = 0;
                const badge = document.getElementById("logCountBadge");
                if (badge) badge.textContent = "0";
                const placeholder = document.getElementById("emptyLogsPlaceholder");
                if (placeholder) placeholder.style.display = "block";
            } catch {}
        });
    }
}
