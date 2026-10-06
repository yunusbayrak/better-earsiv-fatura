# Better e-Arşiv Fatura

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#katkıda-bulunma-ve-pr-istekleri)

Gelir İdaresi Başkanlığı (GİB) e-Arşiv Portalı için geliştirilmiş, hafif, hızlı ve modern bir web arayüzüdür.

GİB portalındaki fatura düzenleme, sorgulama ve imzalama süreçlerini sadeleştirerek kullanıcı dostu ve akıcı bir deneyim sunmayı amaçlar.

---

## Öne Çıkan Özellikler

### Çift Ortam Desteği
- Test Portalı (`earsivportaltest.efatura.gov.tr`) üzerinden deneme faturaları oluşturma.
- Canlı Portal (`earsivportal.efatura.gov.tr`) üzerinden resmi fatura kesme ve imzalama.
- İki ortam arasında arayüz üzerinden tek tıkla geçiş yapabilme.

### Fatura Düzenleme ve Hesaplama
- **Otomatik Alıcı Sorgulama:** VKN veya TCKN girildiğinde mükellef unvanı ve vergi dairesini GİB sisteminden otomatik çeker.
- **Dinamik Kalem Yönetimi:** Sınırsız satır ekleme/çıkarma, birim tipi seçimi, KDV oranları (%0, %1, %10, %20) ve satır bazlı iskonto desteği.
- **Canlı Tutar ve Kur Hesaplama:** Toplam matrah, hesaplanan KDV, genel toplam ve dövizli faturalarda TL karşılığı anlık olarak güncellenir.
- **Yazıyla Tutar:** Ödenecek tutar seçilen para birimine göre (TRY, USD, EUR, GBP) otomatik olarak Türkçe yazıya dökülür.
- **Hazır Şablonlar:** Test amaçlı örnek satış veya ihracat istisnası kalemlerini tek tıkla doldurma imkanı.

### Belge İşlemleri
- **Taslak Kaydetme:** Resmi maliyet veya sorumluluk doğurmadan taslak olarak kaydetme.
- **Doğrudan İmzalama:** Taslağı oluşturup onay koduna gerek kalmadan portal oturumuyla imzalama.
- **HTML Önizleme ve Yazdırma:** GİB resmi şablonuyla fatura çıktısını tarayıcıda görüntüleme ve yazdırma.
- **ZIP İndirme:** Faturayı resmi formatında indirip arşivleme.
- **Geçmiş Faturaları Listeleme:** Belirlenen tarih aralığına göre giden veya adınıza kesilmiş gelen faturaları filtreleme ve sorgulama.
- **Taslak İptali:** İptal gerekçesi girerek onaylanmamış taslakları portaldan silebilme.

### Canlı Sunucu Günlüğü (Logs)
- GİB API istekleri, yanıtları ve olası hata mesajları Server-Sent Events (SSE) ile anlık olarak arayüzdeki terminal panelinde izlenebilir.

### Minimal Bağımlılık ve Tip Güvenliği
- Ağır önyüz framework'leri veya karmaşık derleyiciler gerektirmez.
- Hem sunucu hem de istemci tarafı baştan sona TypeScript ile yazılmıştır.

---

## Kurulum ve Çalıştırma

### Gereksinimler
- Node.js (v18 veya üzeri)
- npm

### 1. Bağımlılıkları Yükleyin
```bash
npm install
```

### 2. Projeyi Derleyin
```bash
npm run build
```

Bu komut hem sunucu TypeScript kodlarını `dist/` klasörüne, hem de istemci kodunu `public/app.js` dosyasına derler.

### 3. Sunucuyu Başlatın
```bash
npm start
```

Sunucu varsayılan olarak 3000 portunda başlar. Tarayıcınızda açmak için:
[http://localhost:3000](http://localhost:3000)

Geliştirme sırasında otomatik derleme ve çalıştırma için:
```bash
npm run dev
```

---

## Proje Yapısı

```
better-earsiv/
├── src/
│   ├── server.ts         # Yerel Node.js HTTP sunucusu ve API rotaları
│   └── gibClient.ts      # GİB e-Arşiv servisleri ile doğrudan haberleşen API istemcisi
├── public/
│   ├── index.html        # Bootstrap 5 tabanlı arayüz
│   ├── app.ts            # İstemci durumu ve kullanıcı etkileşimleri (TypeScript)
│   └── app.js            # Derlenmiş istemci betiği
├── tsconfig.json         # Sunucu TypeScript yapılandırması
├── tsconfig.client.json  # İstemci TypeScript yapılandırması
├── package.json          # Proje betikleri ve bağımlılık tanımları
└── README.md
```

---

## Güvenlik ve Gizlilik

- **Yerel Çalışma:** Bu uygulama yalnızca sizin yerel makinenizde çalışır.
- **Kimlik Bilgileri Saklanmaz:** GİB kullanıcı kodunuz ve parolanız hiçbir yerel veya uzak veritabanına kaydedilmez. Bilgiler yalnızca ilgili oturum boyunca GİB sunucularıyla güvenli iletişim kurmak amacıyla oturum belleğinde (`sessionStorage`) tutulur.
- **Resmi İşlem Sorumluluğu:** Canlı (PROD) portalda imzalanan belgeler yasal olarak geçerli e-Arşiv faturalarıdır. İşlem yaparken doğru ortamda olduğunuza dikkat ediniz.

---

## Katkıda Bulunma ve PR İstekleri

Projeye katkıda bulunmak isteyen herkesin Pull Request (PR) ve Issue bildirimleri memnuniyetle karşılanır. Geliştirme sürecinin düzenli ve güvenli ilerlemesi için lütfen aşağıdaki adımları ve kuralları göz önünde bulundurunuz:

### PR Süreci
1. **Depoyu Çatallayın (Fork):** Projeyi kendi GitHub hesabınıza çatallayın.
2. **Dal Oluşturun:** Yapacağınız geliştirmeye uygun bir dal (branch) açın:
   ```bash
   git checkout -b feature/yeni-ozellik
   # veya
   git checkout -b fix/hata-cozumu
   ```
3. **Geliştirme ve Test:** Değişikliklerinizi yapın ve projenin derlendiğinden emin olun:
   ```bash
   npm run build
   ```
4. **Commit:** Sade, anlaşılır ve konvansiyonel commit mesajları kullanın (örn: `feat: ...`, `fix: ...`).
5. **Pull Request Gönderin:** Değişikliğin neyi amaçladığını ve nasıl test edildiğini açıklayan bir PR oluşturun.

### Dikkat Edilmesi Gerekenler
- **Kişisel Veri Güvenliği:** PR içeriğinde kesinlikle gerçek TCKN, VKN, kullanıcı adı, parola, gerçek fatura verisi veya kişisel HTML çıktıları bulunmamalıdır.
- **Minimal Bağımlılık Prensibi:** Projenin temel hedefi hafif ve yalın kalmaktır; gereksiz dış paket eklemelerinden kaçınınız.
- **Tip Güvenliği:** Hem sunucu hem de istemci tarafındaki TypeScript tip kurallarına uyulmalı ve `npm run build` komutunun sıfır hata ile tamamlanması sağlanmalıdır.

---

## Lisans

Bu proje MIT Lisansı ile lisanslanmıştır.
