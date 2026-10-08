export type EnvironmentKey = "TEST" | "PROD";

export interface InvoiceListItem {
    belgeNumarasi?: string;
    faturaNo?: string;
    ettn?: string;
    uuid?: string;
    belgeTarihi?: string;
    faturaTarihi?: string;
    date?: string;
    aliciUnvanAdSoyad?: string;
    aliciUnvan?: string;
    aliciAdi?: string;
    aliciSoyadi?: string;
    aliciVknTckn?: string;
    vknTckn?: string;
    belgeTuru?: string;
    onayDurumu?: string | boolean;
    odenecek?: string | number;
    toplamTutar?: string | number;
    faturaTutari?: string | number;
    odenecekTutar?: string | number;
    malHizmetToplamTutari?: string | number;
    tutar?: string | number;
    [key: string]: unknown;
}

export interface UserProfileData {
    userCode?: string;
    taxIDOrTRID?: string;
    title?: string;
    name?: string;
    surname?: string;
    registryNo?: string;
    mersisNo?: string;
    taxOffice?: string;
    fullAddress?: string;
    buildingName?: string;
    buildingNumber?: string;
    doorNumber?: string;
    town?: string;
    district?: string;
    city?: string;
    zipCode?: string;
    country?: string;
    phoneNumber?: string;
    faxNumber?: string;
    email?: string;
    webSite?: string;
    businessCenter?: string;
    [key: string]: unknown;
}

export interface GibApiResponse<T = unknown> {
    data?: T;
    metadata?: unknown;
    error?: string;
    messages?: Array<string | { text?: string }>;
    token?: string;
}

export interface InvoiceDraftResult {
    date: string;
    uuid: string;
    data?: unknown;
}

export interface CreateInvoiceResult {
    success: boolean;
    draft: InvoiceDraftResult;
    signed: boolean;
    foundInvoice?: InvoiceListItem;
    message?: string;
}

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";
export type LogCategory = "HTTP" | "GIB" | "INVOICE" | "AUTH" | "SYSTEM";
export type LoggerFn = (level: LogLevel, category: LogCategory, message: string, details?: unknown) => void;

const BASE_URLS: Record<EnvironmentKey, string> = {
    PROD: "https://earsivportal.efatura.gov.tr",
    TEST: "https://earsivportaltest.efatura.gov.tr",
};

/** UUID v4 oluşturucu (tarayıcı uyumlu) */
export function generateUUID(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/** GİB API hata yanıtı denetleyicisi */
function assertApiSuccess(response: GibApiResponse): void {
    if (response.error && response.error !== "0") {
        const raw = response.messages?.[0];
        const text = typeof raw === "string" ? raw : (raw && typeof raw === "object" ? raw.text : "GİB API hatası");
        throw new Error(text || "GİB API hatası");
    }
}

/**
 * İstemci Tabanlı GİB e-Arşiv API İstemcisi
 * Doğrudan tarayıcı içerisinden GİB e-Arşiv servisleri ile konuşur.
 * Sunucu bağımlılığı gerektirmez.
 */
export class GibClient {
    public readonly baseURL: string;
    public readonly env: EnvironmentKey;
    public loginCmd: string = "anologin";
    public logoutCmd: string = "anologin";
    private logger?: LoggerFn;

    constructor(env: EnvironmentKey = "PROD", logger?: LoggerFn) {
        this.env = env;
        this.baseURL = BASE_URLS[env] || BASE_URLS.PROD;
        this.logger = logger;
    }

    /** İstekleri gönderir; Netlify proxy yapılandırılmışsa hata durumunda ters proxy'ye geri düşer */
    private async doFetch(path: string, options: RequestInit): Promise<Response> {
        try {
            return await fetch(`${this.baseURL}${path}`, options);
        } catch (err: unknown) {
            // Eğer doğrudan bağlantı ağ veya CORS engeline takılırsa ve Netlify/Vercel üzerindeysek proxy dene
            if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
                const proxyPath = `/gib-proxy/${this.env.toLowerCase()}${path.replace(/^\/earsiv-services/, "")}`;
                try {
                    this.logger?.("WARN", "HTTP", `Doğrudan bağlantı başarısız oldu, ters proxy deneniyor: ${proxyPath}`);
                    const proxyRes = await fetch(proxyPath, options);
                    if (proxyRes.ok) return proxyRes;
                } catch {
                    // İlk hatayı fırlat
                }
            }
            throw err;
        }
    }

    /** earsiv-services/dispatch üzerinden standart komut çalıştırır */
    public async runCommand<T = unknown>(
        token: string,
        command: string,
        pageName: string,
        data: Record<string, unknown> = {}
    ): Promise<GibApiResponse<T>> {
        const callid = generateUUID();
        const bodyStr = `cmd=${encodeURIComponent(command)}&callid=${encodeURIComponent(callid)}&pageName=${encodeURIComponent(pageName)}&token=${encodeURIComponent(token)}&jp=${encodeURIComponent(JSON.stringify(data))}`;

        let response: Response;
        try {
            response = await this.doFetch(`/earsiv-services/dispatch`, {
                method: "POST",
                headers: {
                    accept: "application/json, text/javascript, */*; q=0.01",
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                body: bodyStr,
            });
        } catch (fetchErr: unknown) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            this.logger?.("ERROR", "HTTP", `GİB dispatch ağ hatası: ${msg}`);
            throw new Error(`GİB sunucusuyla iletişim kurulamadı: ${msg}`);
        }

        if (!response.ok) {
            throw new Error(`GİB sunucu hatası: HTTP ${response.status} ${response.statusText}`);
        }

        const json = (await response.json()) as GibApiResponse<T>;
        assertApiSuccess(json);
        return json;
    }

    /** Giriş yap ve oturum token'ı al */
    public async getToken(username: string, pass: string): Promise<string> {
        this.logger?.("INFO", "AUTH", `GİB girişi deneniyor: Ortam=${this.env}, Kullanıcı=${username}`);
        const bodyStr = `assoscmd=${encodeURIComponent(this.loginCmd)}&rtype=json&userid=${encodeURIComponent(username)}&sifre=${encodeURIComponent(pass)}&sifre2=${encodeURIComponent(pass)}&parola=1&`;

        let response: Response;
        try {
            response = await this.doFetch(`/earsiv-services/assos-login`, {
                method: "POST",
                headers: {
                    accept: "application/json, text/javascript, */*; q=0.01",
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                body: bodyStr,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger?.("ERROR", "AUTH", `GİB giriş ağ hatası: ${msg}`);
            throw new Error(`GİB giriş servisine erişilemedi: ${msg}`);
        }

        if (!response.ok) {
            throw new Error(`GİB giriş sunucu hatası: HTTP ${response.status}`);
        }

        const json = (await response.json()) as GibApiResponse;
        assertApiSuccess(json);
        if (!json.token) {
            throw new Error("GİB oturum token'ı üretilemedi.");
        }

        this.logger?.("INFO", "AUTH", `Giriş başarılı! Token alındı: ${json.token.substring(0, 8)}...`);
        return json.token;
    }

    /** Oturumu kapat */
    public async logout(token: string): Promise<void> {
        this.logger?.("INFO", "AUTH", `Çıkış yapılıyor (Ortam=${this.env})...`);
        const bodyStr = `assoscmd=${encodeURIComponent(this.logoutCmd)}&rtype=json&token=${encodeURIComponent(token)}&`;
        try {
            await this.doFetch(`/earsiv-services/assos-login`, {
                method: "POST",
                headers: {
                    accept: "application/json, text/javascript, */*; q=0.01",
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                body: bodyStr,
            });
            this.logger?.("INFO", "AUTH", "GİB oturumu başarıyla kapatıldı.");
        } catch (err: unknown) {
            this.logger?.("WARN", "AUTH", `GİB çıkış uyarısı: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** VKN / TCKN ile Alıcı Bilgisi Getir */
    public async getRecipientData(token: string, taxId: string): Promise<unknown> {
        this.logger?.("INFO", "GIB", `Alıcı sorgulanıyor: ${taxId} (${this.env})...`);
        const res = await this.runCommand(token, "SICIL_VEYA_MERNISTEN_BILGILERI_GETIR", "RG_BASITFATURA", {
            vknTcknn: taxId,
        });
        this.logger?.("INFO", "GIB", `Alıcı bilgisi başarıyla getirildi.`);
        return res.data;
    }

    /** Düzenlenen Faturaları Getir (Giden) */
    public async getOutgoingInvoices(token: string, startDate: string, endDate: string): Promise<InvoiceListItem[]> {
        this.logger?.("INFO", "GIB", `Giden faturalar sorgulanıyor: ${startDate} - ${endDate} (${this.env})...`);
        const res = await this.runCommand<InvoiceListItem[]>(
            token,
            "EARSIV_PORTAL_TASLAKLARI_GETIR",
            "RG_BASITTASLAKLAR",
            { baslangic: startDate, bitis: endDate, hangiTip: "5000/30000", table: [] }
        );
        const list = Array.isArray(res.data) ? res.data : [];
        list.sort((a, b) => {
            const tA = String(a.belgeTarihi || a.faturaTarihi || a.date || "");
            const tB = String(b.belgeTarihi || b.faturaTarihi || b.date || "");
            return tB.localeCompare(tA);
        });
        this.logger?.("INFO", "GIB", `${list.length} adet giden fatura listelendi.`);
        return list;
    }

    /** Adıma Düzenlenen Faturaları Getir (Gelen) */
    public async getIncomingInvoices(token: string, startDate: string, endDate: string): Promise<InvoiceListItem[]> {
        this.logger?.("INFO", "GIB", `Gelen faturalar sorgulanıyor: ${startDate} - ${endDate} (${this.env})...`);
        const res = await this.runCommand<InvoiceListItem[]>(
            token,
            "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR",
            "RG_ALICI_TASLAKLAR",
            { baslangic: startDate, bitis: endDate, hourlySearchInterval: "NONE" }
        );
        const list = Array.isArray(res.data) ? res.data : [];
        list.sort((a, b) => {
            const tA = String(a.belgeTarihi || a.faturaTarihi || a.date || "");
            const tB = String(b.belgeTarihi || b.faturaTarihi || b.date || "");
            return tB.localeCompare(tA);
        });
        this.logger?.("INFO", "GIB", `${list.length} adet gelen fatura listelendi.`);
        return list;
    }

    /** Fatura HTML Görüntüle */
    public async getInvoiceHTML(token: string, uuid: string, signed: boolean = false): Promise<string> {
        this.logger?.("INFO", "GIB", `Fatura HTML'i alınıyor: ${uuid} (Onay=${signed ? "Onaylandı" : "Onaylanmadı"})...`);
        const res = await this.runCommand<string>(
            token,
            "EARSIV_PORTAL_FATURA_GOSTER",
            "RG_BASITTASLAKLAR",
            {
                ettn: uuid,
                onayDurumu: signed ? "Onaylandı" : "Onaylanmadı",
            }
        );
        const html = typeof res.data === "string" ? res.data : "";
        this.logger?.("INFO", "GIB", `Fatura HTML'i başarıyla alındı (${html.length} bayt).`);
        return html;
    }

    /** Doğrudan GİB ZIP İndirme Bağlantısı Oluştur */
    public getDownloadURL(token: string, invoiceUUID: string, signed: boolean = false): string {
        return (
            `${this.baseURL}/earsiv-services/download` +
            `?token=${encodeURIComponent(token)}&ettn=${encodeURIComponent(invoiceUUID)}&belgeTip=FATURA` +
            `&onayDurumu=${encodeURIComponent(signed ? "Onaylandı" : "Onaylanmadı")}` +
            `&cmd=downloadResource&`
        );
    }

    /** Taslak Faturayı İmzala */
    public async signDraftInvoice(token: string, draftInvoice: InvoiceListItem): Promise<unknown> {
        const uuid = draftInvoice.ettn || draftInvoice.uuid || "Bilinmiyor";
        this.logger?.("INFO", "INVOICE", `Taslak imzalanıyor: ${uuid} (${this.env})...`);
        const res = await this.runCommand(
            token,
            "EARSIV_PORTAL_FATURA_HSM_CIHAZI_ILE_IMZALA",
            "RG_BASITTASLAKLAR",
            { imzalanacaklar: [draftInvoice] }
        );
        this.logger?.("INFO", "INVOICE", `İmzalama işlemi başarıyla tamamlandı.`);
        return res.data;
    }

    /** Taslak Faturayı İptal Et / Sil */
    public async cancelDraftInvoice(token: string, reason: string, draftInvoice: InvoiceListItem): Promise<unknown> {
        const uuid = draftInvoice.ettn || draftInvoice.uuid || "Bilinmiyor";
        this.logger?.("INFO", "INVOICE", `Taslak iptal ediliyor/siliniyor: ${uuid}, Gerekçe: ${reason}...`);
        const res = await this.runCommand(
            token,
            "EARSIV_PORTAL_FATURA_SIL",
            "RG_BASITTASLAKLAR",
            { silinecekler: [draftInvoice], aciklama: reason }
        );
        this.logger?.("INFO", "INVOICE", `Taslak faturası başarıyla iptal edildi.`);
        return res.data;
    }

    /** Mükellef Bilgilerini Getir */
    public async getUserData(token: string): Promise<UserProfileData> {
        this.logger?.("INFO", "GIB", `Mükellef profil bilgileri çekiliyor (${this.env})...`);
        const res = await this.runCommand<Record<string, unknown>>(
            token,
            "EARSIV_PORTAL_KULLANICI_BILGILERI_GETIR",
            "RG_KULLANICI"
        );
        const d = (res.data || {}) as Record<string, string | undefined>;
        const profile: UserProfileData = {
            userCode: d.kullaniciKodu || d.username || d.kodu,
            taxIDOrTRID: d.vknTckn,
            title: d.unvan,
            name: d.ad,
            surname: d.soyad,
            registryNo: d.sicilNo,
            mersisNo: d.mersisNo,
            taxOffice: d.vergiDairesi,
            fullAddress: d.cadde,
            buildingName: d.apartmanAdi,
            buildingNumber: d.apartmanNo,
            doorNumber: d.kapiNo,
            town: d.kasaba,
            district: d.ilce,
            city: d.il,
            zipCode: d.postaKodu,
            country: d.ulke,
            phoneNumber: d.telNo,
            faxNumber: d.faksNo,
            email: d.ePostaAdresi,
            webSite: d.webSitesiAdresi,
            businessCenter: d.isMerkezi,
        };
        this.logger?.("INFO", "GIB", `Mükellef verisi başarıyla alındı: ${profile.title || profile.name || profile.taxIDOrTRID || "-"}`);
        return profile;
    }

    /** Fatura Oluştur (Taslak veya Doğrudan İmzalı) */
    public async createInvoice(
        token: string,
        invoiceDetails: Record<string, any>,
        sign: boolean = false
    ): Promise<CreateInvoiceResult> {
        const rawUuid = typeof invoiceDetails.uuid === "string" ? invoiceDetails.uuid : "";
        const generatedUuid = rawUuid && rawUuid.length === 36 ? rawUuid : generateUUID();

        this.logger?.("INFO", "INVOICE", `Fatura oluşturma başlatıldı (${this.env}). Hedef ETTN: ${generatedUuid}`);

        const inv = invoiceDetails;
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

        // Kalemler listesi
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

        let draftResult: InvoiceDraftResult | null = null;
        let lastCreateError = "";

        // Deneme 1: faturaUuid: "" ile oluşturma
        try {
            this.logger?.("INFO", "GIB", `[Deneme 1] EARSIV_PORTAL_FATURA_OLUSTUR gönderiliyor (faturaUuid: "")...`);
            const payload1 = { ...baseInvoiceData, faturaUuid: "" };
            const resDraft1 = await this.runCommand(token, "EARSIV_PORTAL_FATURA_OLUSTUR", "RG_BASITFATURA", payload1);
            const resText1 = typeof resDraft1.data === "string" ? resDraft1.data.trim() : JSON.stringify(resDraft1.data || "");
            this.logger?.("INFO", "GIB", `GİB Yanıtı (Deneme 1): ${resText1}`);

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
            this.logger?.("WARN", "GIB", `Deneme 1 başarısız: ${lastCreateError}`);
        }

        // Deneme 2 Fallback: faturaUuid & ettn = generatedUuid
        if (!draftResult) {
            try {
                this.logger?.("INFO", "GIB", `[Deneme 2] EARSIV_PORTAL_FATURA_OLUSTUR gönderiliyor (faturaUuid: "${generatedUuid}")...`);
                const payload2 = { ...baseInvoiceData, faturaUuid: generatedUuid, ettn: generatedUuid };
                const resDraft2 = await this.runCommand(token, "EARSIV_PORTAL_FATURA_OLUSTUR", "RG_BASITFATURA", payload2);
                const resText2 = typeof resDraft2.data === "string" ? resDraft2.data.trim() : JSON.stringify(resDraft2.data || "");
                this.logger?.("INFO", "GIB", `GİB Yanıtı (Deneme 2): ${resText2}`);

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
                this.logger?.("ERROR", "GIB", `Deneme 2 başarısız: ${lastCreateError}`);
            }
        }

        if (!draftResult) {
            throw new Error(lastCreateError || "Fatura taslağı oluşturulamadı.");
        }

        this.logger?.("INFO", "INVOICE", `Taslak fatura başarıyla oluşturuldu! ETTN: ${draftResult.uuid}`);

        let isSigned = false;
        let foundInvoice: InvoiceListItem | undefined;

        if (sign) {
            this.logger?.("INFO", "INVOICE", `Taslak fatura imzalanıyor (UUID: ${draftResult.uuid})...`);
            try {
                const allInvoices = await this.getOutgoingInvoices(token, draftResult.date, draftResult.date);
                foundInvoice = allInvoices.find((invItem) => (invItem.ettn || invItem.uuid) === draftResult!.uuid);
                if (foundInvoice) {
                    await this.signDraftInvoice(token, foundInvoice);
                    isSigned = true;
                    this.logger?.("INFO", "INVOICE", `Fatura başarıyla imzalandı! Belge No: ${foundInvoice.belgeNumarasi || "Bilinmiyor"}`);
                } else {
                    this.logger?.("WARN", "INVOICE", `Taslak listede bulunamadı, doğrudan ETTN ile imzalama deneniyor...`);
                    await this.signDraftInvoice(token, { ettn: draftResult.uuid } as InvoiceListItem);
                    isSigned = true;
                }
            } catch (signErr: unknown) {
                const msg = signErr instanceof Error ? signErr.message : String(signErr);
                this.logger?.("ERROR", "INVOICE", `İmzalama aşamasında hata: ${msg}`);
                throw new Error(`Taslak oluşturuldu ancak imzalanamadı: ${msg}`);
            }
        }

        return {
            success: true,
            draft: draftResult,
            signed: isSigned,
            foundInvoice,
            message: isSigned ? "Fatura başarıyla oluşturuldu ve imzalandı." : "Taslak fatura başarıyla oluşturuldu.",
        };
    }
}
