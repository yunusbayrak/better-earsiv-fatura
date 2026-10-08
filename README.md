# Better e-Arşiv Fatura

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Privacy: Fully Local](https://img.shields.io/badge/Privacy-Fully%20Local-success)](#)
[![Canlı Uygulama](https://img.shields.io/badge/Canlı%20Uygulama-Netlify-00C7B7?logo=netlify&logoColor=white)](https://better-earsiv-fatura.netlify.app/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#)

Gelir İdaresi Başkanlığı (GİB) e-Arşiv Portalı için geliştirilmiş, hafif, hızlı, modern ve **%100 istemci tabanlı (client-side)** bir web arayüzüdür.

Uygulamayı herhangi bir kurulum yapmadan doğrudan tarayıcınızda kullanabilirsiniz:  
**[https://better-earsiv-fatura.netlify.app/](https://better-earsiv-fatura.netlify.app/)**

GİB portalındaki fatura düzenleme, sorgulama ve imzalama süreçlerini sadeleştirerek kullanıcı dostu ve akıcı bir deneyim sunar.

---

## Öne Çıkan Özellikler

### Çift Ortam Desteği
- **Test Portalı** (`earsivportaltest.efatura.gov.tr`) üzerinden deneme faturaları oluşturma.
- **Canlı Portal** (`earsivportal.efatura.gov.tr`) üzerinden resmi fatura kesme ve imzalama.
- İki ortam arasında arayüz üzerinden tek tıkla geçiş yapabilme.

### Fatura Düzenleme ve Hesaplama
- **Otomatik Alıcı Sorgulama:** VKN veya TCKN girildiğinde mükellef unvanı ve vergi dairesini GİB sisteminden otomatik çeker.
- **Dinamik Kalem Yönetimi:** Sınırsız satır ekleme/çıkarma, birim tipi seçimi, KDV oranları (%0, %1, %10, %20) ve satır bazlı iskonto desteği.
- **Canlı Tutar ve Kur Hesaplama:** Toplam matrah, hesaplanan KDV, genel toplam ve dövizli faturalarda TL karşılığı anlık olarak güncellenir.
- **Yazıyla Tutar:** Ödenecek tutar seçilen para birimine göre (TRY, USD, EUR, GBP) otomatik olarak Türkçe yazıya dökülür.
- **Hazır Şablonlar:** Test amaçlı örnek satış veya ihracat istisnası kalemlerini tek tıkla doldurma imkanı.
- **Fatura Klonlama:** Önizlenen veya listedeki bir faturayı tek tıkla form alanlarına kopyalayarak yeni fatura oluşturabilme.

### Belge ve İndirme İşlemleri
- **HTML Önizleme ve Yazdırma:** GİB resmi şablonuyla fatura çıktısını modal içerisinde görüntüleme, tarayıcı üzerinden yazdırma veya PDF olarak kaydetme.
- **HTML ve ZIP İndirme:** Faturayı resmi ZIP formatında veya doğrudan HTML dosyası olarak indirme.
- **Taslak Kaydetme ve İmzalama:** Resmi maliyet doğurmadan taslak oluşturma veya portal oturumuyla doğrudan imzalama.
- **Taslak İptali:** İptal gerekçesi girerek onaylanmamış taslakları portaldan silebilme.

### Sorgulama ve Dışa Aktarma
- **Geçmiş Faturaları Listeleme:** Belirlenen tarih aralığına göre hem giden faturaları hem de adınıza düzenlenen (gelen) faturaları sorgulama.
- **Hızlı Tarih Filtreleri:** "Bugün" ve "Dün" butonları ile tek tıkla filtreleme.
- **CSV Dışa Aktarma:** Listelenen faturaları Excel uyumlu CSV dosyası olarak dışa aktarma.
- **Mükellef Bilgileri:** Oturum açılan kullanıcının profil bilgilerini ve kullanıcı kodunu görüntüleme.

### Canlı İşlem Günlüğü (Terminal)
- GİB API istekleri, yanıtları ve olası hata mesajları anlık olarak arayüzdeki terminal panelinde izlenebilir.

### %100 İstemci Tabanlı & Sıfır Aracı Sunucu
- Harici bir backend sunucusuna ihtiyaç duymaz.
- Tüm istekler doğrudan kullanıcının tarayıcısından GİB sunucularına iletilir.
- Baştan sona TypeScript ile geliştirilmiştir.

---

## Kurulum ve Çalıştırma

> Kurulum yapmadan doğrudan kullanmak isterseniz yayındaki sürümü ziyaret edebilirsiniz: **[https://better-earsiv-fatura.netlify.app/](https://better-earsiv-fatura.netlify.app/)**

### Gereksinimler
- Bilgisayarınızda **[Node.js](https://nodejs.org/)** (v18 veya üzeri) kurulu olmalıdır.

### Adım Adım Kurulum

1. **Projeyi İndirin:** Bu sayfadaki **Code > Download ZIP** seçeneğiyle projeyi indirin (veya `git clone` yapın) ve bir klasöre çıkartın.
2. **Terminali Açın:** Proje klasöründe komut satırını / terminali açın.
3. **Bağımlılıkları Yükleyin:**
   ```bash
   npm install
   ```
4. **Projeyi Derleyin:**
   ```bash
   npm run build
   ```
5. **Uygulamayı Başlatın:**
   ```bash
   npm start
   ```

Başlatma işleminden sonra tarayıcınızda açın:  
[http://localhost:3000](http://localhost:3000)

GİB kullanıcı kodu ve şifrenizle giriş yaparak doğrudan kullanmaya başlayabilirsiniz.

> **İpucu:** Uygulamayı kapatmak için terminalde `Ctrl + C` tuşlarına basabilirsiniz. Daha sonra tekrar çalıştırmak istediğinizde sadece `npm start` komutunu vermeniz yeterlidir. Geliştirme sürecinde otomatik derleme için `npm run watch` kullanılabilir.

---

## Proje Yapısı

```
better-earsiv/
├── public/
│   ├── index.html        # Bootstrap 5 tabanlı arayüz
│   ├── app.ts            # İstemci durumu ve kullanıcı etkileşimleri (TypeScript)
│   ├── app.js            # Derlenmiş istemci betiği
│   ├── gibClient.ts      # Doğrudan tarayıcıdan GİB API ile konuşan istemci
│   ├── gibClient.js      # Derlenmiş GİB istemcisi
│   └── gibTemplate.ts    # Resmi GİB fatura HTML şablon üreticisi
├── tsconfig.json         # TypeScript yapılandırması
├── package.json          # Proje betikleri ve bağımlılık tanımları
├── serve.js              # Yerel testler için hafif statik dosya sunucusu
└── README.md
```

---

## Güvenlik ve Gizlilik

- **Doğrudan İstemci İletişimi:** GİB kimlik bilgileriniz hiçbir aracı veya üçüncü parti sunucuya iletilmez. Tüm API istekleri doğrudan tarayıcınızdan GİB sunucularına (`https://earsivportal.efatura.gov.tr`) gönderilir.
- **Kimlik Bilgileri Saklanmaz:** GİB kullanıcı kodunuz ve parolanız hiçbir veritabanına kaydedilmez. Bilgiler yalnızca ilgili tarayıcı sekmesi boyunca oturum belleğinde (`sessionStorage`) tutulur.
- **Resmi İşlem Sorumluluğu:** Canlı (PROD) portalda imzalanan belgeler yasal olarak geçerli e-Arşiv faturalarıdır. İşlem yaparken doğru ortamda olduğunuza dikkat ediniz.

