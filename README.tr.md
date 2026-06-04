# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · **Türkçe** · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Obsidian notlarınızı bilgi kartlarına (flashcard) dönüştürün. Özel bir sözdizimi yok. Oluşturulacak ayrı bir deste yok.**

Bir dosyayı `#decks` ile etiketleyin. Her `##` başlığı kartın ön yüzü, altındaki metin ise arka yüzü olur. Tablolar, görsel örtme (image occlusion) ve `==cloze==` (boşluk doldurma) vurguları da aynı şekilde çalışır. Zamanlama, modern aralıklı tekrar algoritması olan FSRS-6 tarafından yönetilir.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Sürüm notları](./release-notes/) · [Bana bir kahve ısmarla](https://www.buymeacoffee.com/dscherdil0)

## Neden Decks

- **Notlarınız zaten bir destedir.** Bir dosyayı etiketleyin: seçtiğiniz seviyedeki her başlık ön yüz, altındaki metin arka yüz olur. Anki'den geliyorsanız, hiçbir şeyi iki kez yazmanıza gerek kalmaz.
- **Öğrenilecek sözdizimi yok, 4 farklı format.** Başlıklar, iki sütunlu tablolar, görsel örtme ve halihazırda kullandığınız vurgulardan oluşan `==cloze==` boşlukları.
- **FSRS tabanlı zamanlama.** Üç farklı profil (Standart / Yoğun / Eğitilmiş), etiket başına akılda tutma hedefleri, SM-2'nin yükü yok.
- **Algoritma ince ayarı.** Tek tıklamalı optimizasyon aracı, FSRS ağırlıklarını kendi tekrar geçmişinize göre eğitir — tamamen cihazınızda (client-side) gerçekleşen, unutma eğrinize özel daha iyi zamanlamalar.
- **Gerçek çoklu cihaz senkronizasyonu.** Veritabanı iCloud/Dropbox üzerinden otomatik olarak birleşir; telefonda ve bilgisayarda tekrar yapın, geçmişiniz asla kaybolmaz.
- **Mobil cihazlar için tasarlandı.** Dokunmatik ekranlar için optimize edilmiş, telefonlarda her gün test edilen tekrar arayüzü.

## 60 saniyelik hızlı başlangıç

1. Topluluk Eklentilerinden (Community Plugins) **Decks**'i kurun ve etkinleştirin.
2. Herhangi bir notu açın. Frontmatter'a veya metnin içine `#decks` etiketini ekleyin.
3. Bir `##` başlığı yazın, ardından altına bir paragraf ekleyin. İstediğiniz kadar kart için bunu tekrarlayın:

   ```markdown
   ---
   tags: [decks/ingilizce]
   ---

   ## "Hola" ne anlama gelir?

   Merhaba (Hello).

   ## İngilizcede "Teşekkür ederim" nasıl denir?

   Thank you.
   ```

4. Decks panelini açmak için yan çubuktaki **beyin simgesine** tıklayın. Dosyanıza tıklayın. Tekrar etmeye başlayın.

Dosya adı deste adı olur. Notu kaydettiğinizde kartlar otomatik olarak senkronize edilir.

## Kart formatları

Decks kart oluşturmak için dört farklı yolu destekler. Not alma alışkanlığınıza en uygun olanı seçin.

<details>
<summary><b>Başlık + paragraf</b> — varsayılan format. Yapılandırılan seviyedeki her başlık (varsayılan olarak H2) ön yüz, altındaki metin arka yüzdür.</summary>

```markdown
---
tags: [decks/ingilizce]
---

## "Hola" ne anlama gelir?

Hello.

## İngilizcede "Teşekkür ederim" nasıl denir?

Thank you.
```

Dosya adı deste adı olur. Başlık seviyesi profil bazında ayarlanabilir (varsayılan olarak H2). Yapılandırılan seviyenin üzerindeki başlıklar karta dönüştürülmez — bağlam için her karta eklenen bir gezinti yolu (ör. `Bölüm 1 > Kısım 2`) olarak saklanır.

Başlık+paragraf kartına isteğe bağlı **notlar** ekleyin: gövdenin herhangi bir yerine bir Obsidian yorumu (`%%bir ipucu%%`) yazarak ya da sonuna bir `---` ayırıcısından sonra. Notlar, inceleme sırasında istek üzerine (**N** tuşu) gösterilir.

</details>

<details>
<summary><b>Tablolar</b> — isteğe bağlı notlar sütunu içeren iki sütunlu markdown tabloları.</summary>

```markdown
## Kavramlar

| Soru                   | Cevap                                              |
| ---------------------- | -------------------------------------------------- |
| Fotosentez nedir?      | Bitkilerin ışığı dönüştürmek için kullandığı süreç |
| Yerçekimini tanımlayın | Nesneleri birbirine çeken kuvvet                   |
```

- İlk sütun = ön, ikinci sütun = arka. Tablo başlık satırı yok sayılır.
- Tablolar _kesinlikle_ bir başlığın hemen altında yer almalıdır (arada başka paragraf olmamalıdır).
- Tekrar sırasında **N** tuşuna basarak gösterilen ipuçları için üçüncü bir "Notlar" sütunu ekleyebilirsiniz.

</details>

<details>
<summary><b>Boşluk doldurma (Cloze)</b> — gizlemek için metni <code>==metin==</code> ile vurgulayın.</summary>

```markdown
## Güneş Sistemi

==Güneş==, güneş sistemimizin merkezindeki yıldızdır. En yakın gezegen ==Merkür== ve en büyük gezegen ==Jüpiter=='dir.
```

Her vurgu kendi başına bir kart olur. Tekrar sırasında aktif boşluk `[...]` olarak gösterilir; ortaya çıkarmak için dokunun. Boşluk doldurmalar tablo hücrelerinde de çalışır. Varsayılan olarak etkindir.

</details>

<details>
<summary><b>Görsel örtme (Image occlusion)</b> — bir görsel ve numaralandırılmış liste.</summary>

```markdown
## Kol kemikleri

![[arm_bones.png]]

1. ==Humerus==
2. ==Radius==
3. ==Ulna==
```

Listedeki her öğe bir karttır. Görsel ön yüzü oluştururken, ilgili liste öğesi arka yüzünde gizlenir. Boşluk doldurma (cloze) özelliğini temel alır.

</details>

### Canvas desteleri

Markdown dosyası yerine bir Obsidian Canvas (`.canvas`) dosyasında kart oluşturun. Yapılandırılan klasördeki her canvas bir deste olur; her metin düğümü yukarıdakiyle aynı dört kart biçimiyle ayrıştırılır. **Ayarlar → Canvas desteleri** üzerinden yapılandırın: klasör ve etiket (varsayılan `#decks/canvas`). İnceleme sırasında "Kaynağa git", canvas'ı açar ve kaynak düğümü odaklar. İlk kurulumda (veya güncellemede) `Canvas decks/` klasörünün içinde otomatik olarak `Decks — Canvas başlangıç.canvas` oluşturulur.

**Uzamsal kartlar (Spatial cards)**: metin düğümlerini kenarlarla birbirine bağlayın — her kenar bir karta dönüşür: kaynak düğüm ön yüz (soru), hedef düğüm arka yüz (cevap), kenar etiketi ise isteğe bağlı bir ipucudur. Zincirler (A → B → C), bire-çok ve çoğa-bir ilişkilerin tümü çalışır; bağlanmamış düğümler yine yukarıdaki dört biçimle ayrıştırılır. Ayrıntılar için **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

![Canvas Spatial Cards Demo](./canvas_spatial_cards_demo.gif)

## Kişiselleştirilmiş planlama

FSRS, kutudan çıktığı gibi harika çalışan mantıklı varsayılanlarla gelir. Yaklaşık 100 tekrar biriktirdiğinizde, algoritmanın 21 ağırlığını kendi tekrar geçmişinize göre eğitebilir ve unutma eğrinize özel planlamalar elde edebilirsiniz — tıpkı Anki'nin masaüstü sürümünün yaptığı gibi, ancak sunucu veya veri toplama olmadan, tamamen cihazınızda (lokal).

**Ayarlar → Algoritma ince ayarı → Parametreleri optimize et.** Eğitim, tipik desteler için saniyeler içinde tamamlanır; öncesi/sonrası bir "log-loss" karşılaştırması göreceksiniz. Eğitilmiş ağırlıkları kullanmak için "Uygula"ya tıklayın.

## Sürüm notları & Destek

- Her sürüm için **Sürüm notları** [`release-notes/`](./release-notes/) klasöründedir.
- **Discord'da tartışın** — [sunucuya katılın](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Geliştirmeyi destekleyin** — [Bana bir kahve ısmarla](https://www.buymeacoffee.com/dscherdil0).
- **Çeviri Rehberi** - [Çeviri Rehberi](./docs/TRANSLATING.md).

## Yapay zekâ desteği (isteğe bağlı)

İsteğe bağlı yapay zekâ özellikleri, **Ayarlar → Yapay Zekâ bölümünde bir sağlayıcı anahtarı ekleyene kadar kapalıdır**:

- **Oluştur** — bir komuttan (ve isteğe bağlı not/görsellerden) kart üretin ve bunları yeni bir dosyaya veya mevcut bir desteye başlık+paragraf, tablo ya da tuval olarak kaydedin.
- Bir kartı veya tüm bir seçimi **yeniden düzenleyin**, ya da bir kartı birkaç karta **bölün** — her değişikliği uygulamadan önce gözden geçirirsiniz.

Kendi OpenAI, Anthropic (Claude), Google (Gemini) anahtarınızı ya da OpenAI uyumlu/yerel bir uç noktayı kullanın. Anahtarlar yerel olarak `ai-keys.json` içinde tutulur ve asla `data.json` dosyasına yazılmaz; böylece senkronizasyon yoluyla cihazınızdan çıkmaz. Bir eylem başlatmadıkça sağlayıcıya hiçbir şey gönderilmez; her istek yalnızca Decks'in nasıl çalıştığına dair yerleşik bir komut, talimatlarınız ve o eylemin içeriğini barındırır.

![Decks AI Generator](./decks_ai_generate.gif)

## Üzerine kurulu

Decks, ayrıştırma, FSRS planlama, senkronizasyon ve yapay zekâ orkestrasyonunu sağlayan açık kaynaklı (MIT) **[`@decks/core`](https://github.com/dscherdi/decks-core)** motoru üzerine kuruludur. Eklenti, onun çevresindeki Obsidian'a özgü kabuktur.

## Lisans

Bkz. [LICENSE](./LICENSE).

---

> Bu çeviri bir taslaktır — anadili Türkçe olanlardan gelecek Pull Request'ler memnuniyetle karşılanır.
