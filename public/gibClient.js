const BASE_URLS = {
    PROD: "https://earsivportal.efatura.gov.tr",
    TEST: "https://earsivportaltest.efatura.gov.tr",
};
/** UUID v4 oluşturucu (tarayıcı uyumlu) */
export function generateUUID() {
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
function assertApiSuccess(response) {
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
    baseURL;
    env;
    loginCmd = "anologin";
    logoutCmd = "anologin";
    logger;
    constructor(env = "PROD", logger) {
        this.env = env;
        this.baseURL = BASE_URLS[env] || BASE_URLS.PROD;
        this.logger = logger;
    }
    /** İstekleri gönderir; Netlify proxy yapılandırılmışsa hata durumunda ters proxy'ye geri düşer */
    async doFetch(path, options) {
        try {
            return await fetch(`${this.baseURL}${path}`, options);
        }
        catch (err) {
            // Eğer doğrudan bağlantı ağ veya CORS engeline takılırsa ve Netlify/Vercel üzerindeysek proxy dene
            if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
                const proxyPath = `/gib-proxy/${this.env.toLowerCase()}${path.replace(/^\/earsiv-services/, "")}`;
                try {
                    this.logger?.("WARN", "HTTP", `Doğrudan bağlantı başarısız oldu, ters proxy deneniyor: ${proxyPath}`);
                    const proxyRes = await fetch(proxyPath, options);
                    if (proxyRes.ok)
                        return proxyRes;
                }
                catch {
                    // İlk hatayı fırlat
                }
            }
            throw err;
        }
    }
    /** earsiv-services/dispatch üzerinden standart komut çalıştırır */
    async runCommand(token, command, pageName, data = {}) {
        const callid = generateUUID();
        const bodyStr = `cmd=${encodeURIComponent(command)}&callid=${encodeURIComponent(callid)}&pageName=${encodeURIComponent(pageName)}&token=${encodeURIComponent(token)}&jp=${encodeURIComponent(JSON.stringify(data))}`;
        let response;
        try {
            response = await this.doFetch(`/earsiv-services/dispatch`, {
                method: "POST",
                headers: {
                    accept: "application/json, text/javascript, */*; q=0.01",
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                body: bodyStr,
            });
        }
        catch (fetchErr) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            this.logger?.("ERROR", "HTTP", `GİB dispatch ağ hatası: ${msg}`);
            throw new Error(`GİB sunucusuyla iletişim kurulamadı: ${msg}`);
        }
        if (!response.ok) {
            throw new Error(`GİB sunucu hatası: HTTP ${response.status} ${response.statusText}`);
        }
        const json = (await response.json());
        assertApiSuccess(json);
        return json;
    }
    /** Giriş yap ve oturum token'ı al */
    async getToken(username, pass) {
        this.logger?.("INFO", "AUTH", `GİB girişi deneniyor: Ortam=${this.env}, Kullanıcı=${username}`);
        const bodyStr = `assoscmd=${encodeURIComponent(this.loginCmd)}&rtype=json&userid=${encodeURIComponent(username)}&sifre=${encodeURIComponent(pass)}&sifre2=${encodeURIComponent(pass)}&parola=1&`;
        let response;
        try {
            response = await this.doFetch(`/earsiv-services/assos-login`, {
                method: "POST",
                headers: {
                    accept: "application/json, text/javascript, */*; q=0.01",
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                body: bodyStr,
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger?.("ERROR", "AUTH", `GİB giriş ağ hatası: ${msg}`);
            throw new Error(`GİB giriş servisine erişilemedi: ${msg}`);
        }
        if (!response.ok) {
            throw new Error(`GİB giriş sunucu hatası: HTTP ${response.status}`);
        }
        const json = (await response.json());
        assertApiSuccess(json);
        if (!json.token) {
            throw new Error("GİB oturum token'ı üretilemedi.");
        }
        this.logger?.("INFO", "AUTH", `Giriş başarılı! Token alındı: ${json.token.substring(0, 8)}...`);
        return json.token;
    }
    /** Oturumu kapat */
    async logout(token) {
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
        }
        catch (err) {
            this.logger?.("WARN", "AUTH", `GİB çıkış uyarısı: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** VKN / TCKN ile Alıcı Bilgisi Getir */
    async getRecipientData(token, taxId) {
        this.logger?.("INFO", "GIB", `Alıcı sorgulanıyor: ${taxId} (${this.env})...`);
        const res = await this.runCommand(token, "SICIL_VEYA_MERNISTEN_BILGILERI_GETIR", "RG_BASITFATURA", {
            vknTcknn: taxId,
        });
        this.logger?.("INFO", "GIB", `Alıcı bilgisi başarıyla getirildi.`);
        return res.data;
    }
    /** Düzenlenen Faturaları Getir (Giden) */
    async getOutgoingInvoices(token, startDate, endDate) {
        this.logger?.("INFO", "GIB", `Giden faturalar sorgulanıyor: ${startDate} - ${endDate} (${this.env})...`);
        const res = await this.runCommand(token, "EARSIV_PORTAL_TASLAKLARI_GETIR", "RG_BASITTASLAKLAR", { baslangic: startDate, bitis: endDate, hangiTip: "5000/30000", table: [] });
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
    async getIncomingInvoices(token, startDate, endDate) {
        this.logger?.("INFO", "GIB", `Gelen faturalar sorgulanıyor: ${startDate} - ${endDate} (${this.env})...`);
        const res = await this.runCommand(token, "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR", "RG_ALICI_TASLAKLAR", { baslangic: startDate, bitis: endDate, hourlySearchInterval: "NONE" });
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
    async getInvoiceHTML(token, uuid, signed = false) {
        this.logger?.("INFO", "GIB", `Fatura HTML'i alınıyor: ${uuid} (Onay=${signed ? "Onaylandı" : "Onaylanmadı"})...`);
        const res = await this.runCommand(token, "EARSIV_PORTAL_FATURA_GOSTER", "RG_BASITTASLAKLAR", {
            ettn: uuid,
            onayDurumu: signed ? "Onaylandı" : "Onaylanmadı",
        });
        const html = typeof res.data === "string" ? res.data : "";
        this.logger?.("INFO", "GIB", `Fatura HTML'i başarıyla alındı (${html.length} bayt).`);
        return html;
    }
    /** Doğrudan GİB ZIP İndirme Bağlantısı Oluştur */
    getDownloadURL(token, invoiceUUID, signed = false) {
        return (`${this.baseURL}/earsiv-services/download` +
            `?token=${encodeURIComponent(token)}&ettn=${encodeURIComponent(invoiceUUID)}&belgeTip=FATURA` +
            `&onayDurumu=${encodeURIComponent(signed ? "Onaylandı" : "Onaylanmadı")}` +
            `&cmd=downloadResource&`);
    }
    /** Taslak Faturayı İmzala */
    async signDraftInvoice(token, draftInvoice) {
        const uuid = draftInvoice.ettn || draftInvoice.uuid || "Bilinmiyor";
        this.logger?.("INFO", "INVOICE", `Taslak imzalanıyor: ${uuid} (${this.env})...`);
        const res = await this.runCommand(token, "EARSIV_PORTAL_FATURA_HSM_CIHAZI_ILE_IMZALA", "RG_BASITTASLAKLAR", { imzalanacaklar: [draftInvoice] });
        this.logger?.("INFO", "INVOICE", `İmzalama işlemi başarıyla tamamlandı.`);
        return res.data;
    }
    /** Taslak Faturayı İptal Et / Sil */
    async cancelDraftInvoice(token, reason, draftInvoice) {
        const uuid = draftInvoice.ettn || draftInvoice.uuid || "Bilinmiyor";
        this.logger?.("INFO", "INVOICE", `Taslak iptal ediliyor/siliniyor: ${uuid}, Gerekçe: ${reason}...`);
        const res = await this.runCommand(token, "EARSIV_PORTAL_FATURA_SIL", "RG_BASITTASLAKLAR", { silinecekler: [draftInvoice], aciklama: reason });
        this.logger?.("INFO", "INVOICE", `Taslak faturası başarıyla iptal edildi.`);
        return res.data;
    }
    /** Mükellef Bilgilerini Getir */
    async getUserData(token) {
        this.logger?.("INFO", "GIB", `Mükellef profil bilgileri çekiliyor (${this.env})...`);
        const res = await this.runCommand(token, "EARSIV_PORTAL_KULLANICI_BILGILERI_GETIR", "RG_KULLANICI");
        const d = (res.data || {});
        const profile = {
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
    async createInvoice(token, invoiceDetails, sign = false) {
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
            const it = item;
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
        const baseInvoiceData = {
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
        let draftResult = null;
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
            }
            else {
                lastCreateError = resText1;
            }
        }
        catch (err1) {
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
                }
                else {
                    lastCreateError = resText2;
                }
            }
            catch (err2) {
                lastCreateError = err2 instanceof Error ? err2.message : String(err2);
                this.logger?.("ERROR", "GIB", `Deneme 2 başarısız: ${lastCreateError}`);
            }
        }
        if (!draftResult) {
            throw new Error(lastCreateError || "Fatura taslağı oluşturulamadı.");
        }
        this.logger?.("INFO", "INVOICE", `Taslak fatura başarıyla oluşturuldu! ETTN: ${draftResult.uuid}`);
        let isSigned = false;
        let foundInvoice;
        if (sign) {
            this.logger?.("INFO", "INVOICE", `Taslak fatura imzalanıyor (UUID: ${draftResult.uuid})...`);
            try {
                const allInvoices = await this.getOutgoingInvoices(token, draftResult.date, draftResult.date);
                foundInvoice = allInvoices.find((invItem) => (invItem.ettn || invItem.uuid) === draftResult.uuid);
                if (foundInvoice) {
                    await this.signDraftInvoice(token, foundInvoice);
                    isSigned = true;
                    this.logger?.("INFO", "INVOICE", `Fatura başarıyla imzalandı! Belge No: ${foundInvoice.belgeNumarasi || "Bilinmiyor"}`);
                }
                else {
                    this.logger?.("WARN", "INVOICE", `Taslak listede bulunamadı, doğrudan ETTN ile imzalama deneniyor...`);
                    await this.signDraftInvoice(token, { ettn: draftResult.uuid });
                    isSigned = true;
                }
            }
            catch (signErr) {
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
