import crypto from "node:crypto";

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

const BASE_URLS: Record<EnvironmentKey, string> = {
    PROD: "https://earsivportal.efatura.gov.tr",
    TEST: "https://earsivportaltest.efatura.gov.tr",
};

/** GİB API hata yanıtı fırlatıcı */
function assertApiSuccess(response: GibApiResponse): void {
    if (response.error && response.error !== "0") {
        const raw = response.messages?.[0];
        const text = typeof raw === "string" ? raw : (raw && typeof raw === "object" ? raw.text : "GİB API hatası");
        throw new Error(text || "GİB API hatası");
    }
}

/**
 * Yerel GİB e-Arşiv API İstemcisi
 * Dış bir kütüphaneye bağımlı kalmadan GİB'in en güncel kurallarına göre doğrudan konuşur.
 */
export class GibClient {
    public readonly baseURL: string;
    public readonly env: EnvironmentKey;
    public loginCmd: string = "anologin";
    public logoutCmd: string = "anologin";

    constructor(env: EnvironmentKey = "PROD") {
        this.env = env;
        this.baseURL = BASE_URLS[env] || BASE_URLS.PROD;
    }

    private buildHeaders(): Record<string, string> {
        return {
            accept: "*/*",
            "accept-language": "tr,en-US;q=0.9,en;q=0.8",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            pragma: "no-cache",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
        };
    }

    /** earsiv-services/dispatch üzerinden standart komut çalıştırır */
    public async runCommand<T = unknown>(
        token: string,
        command: string,
        pageName: string,
        data: Record<string, unknown> = {}
    ): Promise<GibApiResponse<T>> {
        const callid = crypto.randomUUID();
        const bodyStr = `cmd=${encodeURIComponent(command)}&callid=${encodeURIComponent(callid)}&pageName=${encodeURIComponent(pageName)}&token=${encodeURIComponent(token)}&jp=${encodeURIComponent(JSON.stringify(data))}`;

        const response = await fetch(`${this.baseURL}/earsiv-services/dispatch`, {
            method: "POST",
            headers: this.buildHeaders(),
            body: bodyStr,
        });

        if (!response.ok) {
            throw new Error(`GİB sunucu hatası: HTTP ${response.status} ${response.statusText}`);
        }

        const json = (await response.json()) as GibApiResponse<T>;
        assertApiSuccess(json);
        return json;
    }

    /** Giriş yap ve oturum token'ı al */
    public async getToken(username: string, pass: string): Promise<string> {
        const bodyStr = `assoscmd=${encodeURIComponent(this.loginCmd)}&rtype=json&userid=${encodeURIComponent(username)}&sifre=${encodeURIComponent(pass)}&sifre2=${encodeURIComponent(pass)}&parola=1&`;
        const response = await fetch(`${this.baseURL}/earsiv-services/assos-login`, {
            method: "POST",
            headers: this.buildHeaders(),
            body: bodyStr,
        });

        if (!response.ok) {
            throw new Error(`GİB giriş sunucu hatası: HTTP ${response.status}`);
        }

        const json = (await response.json()) as GibApiResponse;
        assertApiSuccess(json);
        if (!json.token) {
            throw new Error("GİB token üretilemedi.");
        }
        return json.token;
    }

    /** Oturumu kapat */
    public async logout(token: string): Promise<unknown> {
        const bodyStr = `assoscmd=${encodeURIComponent(this.logoutCmd)}&rtype=json&token=${encodeURIComponent(token)}&`;
        const response = await fetch(`${this.baseURL}/earsiv-services/assos-login`, {
            method: "POST",
            headers: this.buildHeaders(),
            body: bodyStr,
        });
        const json = (await response.json()) as GibApiResponse;
        return json.data;
    }

    /** VKN / TCKN ile Alıcı Bilgisi Getir */
    public async getRecipientData(token: string, taxId: string): Promise<unknown> {
        const res = await this.runCommand(token, "SICIL_VEYA_MERNISTEN_BILGILERI_GETIR", "RG_BASITFATURA", {
            vknTcknn: taxId,
        });
        return res.data;
    }

    /** Düzenlenen Faturaları Getir (Giden) */
    public async getOutgoingInvoices(token: string, startDate: string, endDate: string): Promise<InvoiceListItem[]> {
        const res = await this.runCommand<InvoiceListItem[]>(
            token,
            "EARSIV_PORTAL_TASLAKLARI_GETIR",
            "RG_BASITTASLAKLAR",
            { baslangic: startDate, bitis: endDate, hangiTip: "5000/30000", table: [] }
        );
        return Array.isArray(res.data) ? res.data : [];
    }

    /** Adıma Düzenlenen Faturaları Getir (Gelen) */
    public async getIncomingInvoices(token: string, startDate: string, endDate: string): Promise<InvoiceListItem[]> {
        const res = await this.runCommand<InvoiceListItem[]>(
            token,
            "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR",
            "RG_ALICI_TASLAKLAR",
            { baslangic: startDate, bitis: endDate, hangiTip: "5000/30000", table: [] }
        );
        return Array.isArray(res.data) ? res.data : [];
    }

    /** Fatura HTML Görüntüle */
    public async getInvoiceHTML(token: string, uuid: string, signed: boolean = false): Promise<string> {
        const res = await this.runCommand<string>(
            token,
            "EARSIV_PORTAL_FATURA_GOSTER",
            "RG_BASITTASLAKLAR",
            {
                ettn: uuid,
                onayDurumu: signed ? "Onaylandı" : "Onaylanmadı",
            }
        );
        return typeof res.data === "string" ? res.data : "";
    }

    /** İndirme Linki Oluştur */
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
        const res = await this.runCommand(
            token,
            "EARSIV_PORTAL_FATURA_HSM_CIHAZI_ILE_IMZALA",
            "RG_BASITTASLAKLAR",
            { imzalanacaklar: [draftInvoice] }
        );
        return res.data;
    }

    /** Taslak Faturayı İptal Et / Sil */
    public async cancelDraftInvoice(token: string, reason: string, draftInvoice: InvoiceListItem): Promise<unknown> {
        const res = await this.runCommand(
            token,
            "EARSIV_PORTAL_FATURA_SIL",
            "RG_BASITTASLAKLAR",
            { silinecekler: [draftInvoice], aciklama: reason }
        );
        return res.data;
    }

    /** Mükellef Bilgilerini Getir */
    public async getUserData(token: string): Promise<UserProfileData> {
        const res = await this.runCommand<Record<string, unknown>>(
            token,
            "EARSIV_PORTAL_KULLANICI_BILGILERI_GETIR",
            "RG_KULLANICI"
        );
        const d = (res.data || {}) as Record<string, string | undefined>;
        return {
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
    }
}
