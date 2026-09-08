# SBC Monkey incelemesi — 9 Eylül 2026

Amaç, Monkey'nin veri ve çözüm akışını anlayıp MIT Auto-SBC forkunda bağımsız bir yerel karşılık geliştirmek. Ücretli uzantının kodu bu depoya alınmadı.

## Doğrulanan akış

Üreticinin [SSS açıklaması](https://www.sbcmonkey.com/) ve üreticinin bağlantı verdiği [public 1.1.56 uzantı paketi](https://extensioncode.app/?id=fdkndehkhodnbelfdlnpgnmegjdklkic) incelendi. Kurulu Chrome profilinin dosyaları kullanılmadı.

1. EA ekranındaki düğme, kulüp ve SBC deposu kartlarını, görev şartlarını, kilitleri ve aktif kadro kimliklerini topluyor.
2. Arka plan bileşeni ayarları ekliyor ve sıkıştırılmış JSON isteğini `https://solver.sbcmonkey.com/` adresine gönderiyor.
3. Sunucunun seçtiği kartlar EA kadrosuna yerleştirilip kaydediliyor. Konsept sonuçların kimlikleri EA'nın konsept aramasıyla kart nesnelerine çevriliyor.
4. Son teslim ayrı `Exchange Players` işlemi. Konsept kartı satın almak kullanıcıya ait.

Piyasa değerine uygulanan tercih çarpanları: satılamaz kopya 0,1; satılamaz 0,7; satılabilir 1; konsept 2. Depo için public pakette 0,5 varsayılanı var. Fiyatsız objective kartlarda aynı reyting grubunun P60 değeri kullanılıyor. Konsept sayısı ayarı 0–200; incelenen pakette varsayılan 0. Aktif kadroyu hariç tutma ayarı da varsayılan olarak kapalı.

Tarayıcı paketinde piyasa fiyatlarını indiren bir sağlayıcı bağlantısı bulunmadı. Fiyat sağlayıcısı, sunucunun matematiksel çözüm motoru ve konsept aday havuzunun kurulma yöntemi doğrulanamadı. Monkey'nin FUTBIN, FUT.GG veya OR-Tools kullandığı varsayılmıyor.

## Auto-SBC'ye etkisi

| Gözlem | Bizim uygulama |
| --- | --- |
| Hesaplama sunucuda | Kulüp verisi yerel Python çözücüye gider. |
| Kulüp + konsept maliyeti | Gerçek fiyatlı katalog adayları, ayrı satın alma bütçesi ve alışveriş listesi kullanılır. |
| EA görev ekranında çözüm düğmesi | `Auto-SBC ile çöz` mevcut çözüm/inceleme akışına bağlanır. |
| Ekran yüklenirken erken tıklamalar yanıt vermeyebiliyor | Düğme, görev kimliği ve bağlantı hazır olduğunda açılır; gezinme eski sonucu geçersiz kılar. |
| Toplam tamamlanma ile günlük kalan hak farklı | Gözlemler test örneği olarak kaydedildi; bilinmeyen EA alanlarından sayaç uydurulmuyor. |
| Günlük son hakkı bitince toplam sayaç kaybolabiliyor | Eksik değer sıfır sayılmıyor. |
| Özel kartlar oynanmış olsa da seçilebiliyor | Özel/evolution koruması varsayılan açık; aktif kadro ayrıca korunur. |

27.0.2 sürümünde konsept sonuç, incelemeden sonra **Konseptleri kadroya yerleştir** ile EA SBC ekranına yerleştirilebilir. Her kart tam tanım kimliğiyle EA'nın konsept aramasından alınır; sahte sahiplik oluşturulmaz. Fiyat ve alışveriş listesi panelde kalır. Bu işlem satın alma veya SBC teslimi yapmaz.

## Doğrulama sınırı

Kullanıcının kurduğu 27.0.1 sürümüyle 10 Daily Silver Upgrade çözüldü, uygulandı, EA'dan teslim edildi ve ödüller alındı. Kullanılan kartların her biri 65 reytingli ve sıfır maçlıydı. Konsept önizlemesi ayrıca 65 Xavier Dziekoński için 200 coin kaynak fiyatı üretti; canlı piyasada gözlenen en düşük ilan 350 coindi. Kart satın alınmadı, bakiye 577.251 olarak kaldı. 27.0.2 konsept yerleştirmesinin canlı doğrulaması uzantı yenilenmesini bekliyor. Depodaki bir kartın kaydı EA 500 verdi; bu konu açık.

Oynanmış bütün kartları otomatik tespit etme henüz uygulanmadı. Public Monkey akışında da maç geçmişi alanı bulunmadı. Aktif kadro/özel/evolution/kilit korumaları maç geçmişi korumasının yerine geçtiği iddiasıyla sunulmamalı. Sonraki canlı bağlantıda gerçek EA alanı doğrulanmalı ve oynanmış kartlar fiyat cezası yerine kesin dışlama kuralıyla korunmalı.
