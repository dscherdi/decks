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
<summary><b>Görsel örtme (Image occlusion)</b> — bir görselin bölgelerini gizleyip altında ne olduğunu hatırlayın. İki yol: etkileşimli (kutu çizme) veya numaralandırılmış liste.</summary>

**Etkileşimli (önerilir).** **"İmleç konumunda görüntü gizleme oluştur"** komutunu çalıştırın, bir görsel seçin ve doğrudan düzenleyicide üzerine kutular çizin. Her kutu için bir Markdown/LaTeX cevabı yazın veya görselde gömülü bir etiketi yalnızca gizlemek için boş bırakın. Bağımsız bir `decks-occlusion` kod bloğu olarak kaydedilir (koordinatlar yüzde olduğundan her cihaza uyum sağlar):

````markdown
```decks-occlusion
image: "[[heart.png]]"
version: 2
masks:
  - id: m1
    x: 12.5
    y: 30
    w: 18
    h: 9.5
    answer: "Sol **ventrikül**"
  - id: m2
    x: 55
    y: 22
    w: 14
    h: 8
    answer: ""
```
````

Her kutu bir karttır. Tekrarda kutu ön yüzde gizlenir ve arka yüzde (cevabıyla) açığa çıkar; okuma görünümünde tamamen etiketli diyagramı görürsünüz. Bloğun **Düzenle** düğmesinden veya kart yöneticisinden istediğiniz zaman düzenlenebilir.

**Numaralandırılmış liste (basit).** Gömülü bir görselin ardından numaralandırılmış bir liste de çalışır:

```markdown
## Kol kemikleri

![[arm_bones.png]]

1. ==Humerus==
2. ==Radius==
3. ==Ulna==
```

Listedeki her öğe bir karttır; görsel ön yüzde gösterilir ve ilgili öğe arka yüzde gizlenir.

İkisi de boşluk doldurma (cloze) özelliğine dayanır; bu nedenle profilde cloze etkin olmalı ve blok ayrıştırılan bir başlığın altında bulunmalıdır.

</details>

### Canvas desteleri

Markdown dosyası yerine bir Obsidian Canvas (`.canvas`) dosyasında kart oluşturun. Yapılandırılan klasördeki her canvas bir deste olur; her metin düğümü yukarıdakiyle aynı dört kart biçimiyle ayrıştırılır. **Ayarlar → Canvas desteleri** üzerinden yapılandırın: klasör ve etiket (varsayılan `#decks/canvas`). İnceleme sırasında "Kaynağa git", canvas'ı açar ve kaynak düğümü odaklar. İlk kurulumda (veya güncellemede) `Canvas decks/` klasörünün içinde otomatik olarak `Decks — Canvas başlangıç.canvas` oluşturulur.

**Uzamsal kartlar (Spatial cards)**: metin düğümlerini kenarlarla birbirine bağlayın — her kenar bir karta dönüşür: kaynak düğüm ön yüz (soru), hedef düğüm arka yüz (cevap), kenar etiketi ise isteğe bağlı bir ipucudur. Zincirler (A → B → C), bire-çok ve çoğa-bir ilişkilerin tümü çalışır; bağlanmamış düğümler yine yukarıdaki dört biçimle ayrıştırılır. Ayrıntılar için **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

![Canvas Spatial Cards Demo](./canvas_spatial_cards_demo.gif)

## Şablonlar

Bir tablonun satırlarını, bir kez tasarladığınız bir kart tasarımıyla işleyin. Tasarımı HTML/CSS veya Markdown
ile yazın, `{{Column}}` yer tutucularını yerleştirin ve bir etiketle tablolarınıza bağlayın — tek bir şablon,
eşleşen her satıra biçim verir.

```decks-html-front
<ruby>{{Word}}<rt>{{Reading}}</rt></ruby>
```

**Ayarlar → Şablonlar** bölümünden bir klasör seçin, şablon dosyasını ve tablonun başlığını aynı etiketle
etiketleyin — hazırsınız. Şablonlar HTML veya Markdown ile ön/arka/not yüzlerini destekler; arındırılmış,
temaya duyarlı ve yalıtılmış bir alanda işlenir ve tam düzen denetimi için CSS değişkenleri (`--padding`,
`--align`, `--bg`, …) sunar — rahat okuma kartlarından kenardan kenara özel tasarımlara kadar. Eşleşen şablonu
olmayan tablolar yine normal sütunları kullanır.

Tam kılavuz ve örnekler için **[docs/TEMPLATES.md](docs/TEMPLATES.md)** bölümüne bakın.

## Kişiselleştirilmiş planlama

FSRS, kutudan çıktığı gibi harika çalışan mantıklı varsayılanlarla gelir. Yaklaşık 100 tekrar biriktirdiğinizde, algoritmanın 21 ağırlığını kendi tekrar geçmişinize göre eğitebilir ve unutma eğrinize özel planlamalar elde edebilirsiniz — tıpkı Anki'nin masaüstü sürümünün yaptığı gibi, ancak sunucu veya veri toplama olmadan, tamamen cihazınızda (lokal).

**Ayarlar → Algoritma ince ayarı → Parametreleri optimize et.** Eğitim, tipik desteler için saniyeler içinde tamamlanır; öncesi/sonrası bir "log-loss" karşılaştırması göreceksiniz. Eğitilmiş ağırlıkları kullanmak için "Uygula"ya tıklayın.

## Spaced Repetition'dan geçiş

Halihazırda **Spaced Repetition** eklentisini mi kullanıyorsunuz? Decks'e **kartlarınızı veya tekrar geçmişinizi kaybetmeden** geçebilir — ve tekrarlarınıza tam da bıraktığınız yerden devam edebilirsiniz.

Geçiş aracını deste paneli araç çubuğundan (küp simgesi) açın veya **"Spaced Repetition eklentisinden geçiş yap"** komutunu çalıştırın.

**Orijinal notlarınıza asla dokunulmaz.** Geçiş eklemelidir: seçtiğiniz bir hedef klasöre yeni dosyalar yazar (yapınızı yansıtarak) ve kaynak notlarınızı oldukları gibi bırakır. Geçiş aracını yeniden çalıştırmak, yalnızca ürettiği dosyaların üzerine yazar.

**Nasıl çalışır**

1. **Taranacak bir kaynak klasör** seçin (veya tüm kasayı taramak için boş bırakın) ve çıktı için bir hedef klasör belirleyin. Decks, eski kartları olan her notu bulur — tek satırlık (`Front :: Back`), ters (`Front ::: Back`), çok satırlı (`?` / `??`), boşluk doldurmalı (`==…==` / `{{…}}`) — ve tüm notu kapsayan tekrarları (`#review` etiketi).
2. **Her not iki temiz dosyaya bölünür.** Bir **kart destesi** (`<Not> (Kartlar)`) ayıklanan kartları standart Decks biçiminde tutar; bir **okunabilir not** ise düz metni saklar — kart söz dizimi normal metne *çözülür* (`::` / `:::` " — " olur, `?` / `??` soru ile cevabı birleştirir ve `==…==` / `{{…}}` boşlukları cevaplarına geri döndürülür). Yapılandırdığınız ayraçlar dikkate alınır, böylece bunları özelleştirmiş olsanız bile çalışır. Hiçbir şey çıkarılmaz — okuma notunuz eksiksiz kalır.
3. **Dosyalar frontmatter'da çapraz bağlanır.** Okunabilir not, destesine işaret eden bir `Kartlar` özelliği ve orijinale geri işaret eden bir `Köken notu` özelliği alır; deste de bir `Köken notu` özelliği alır. Bir not zaten bu özellik adlarından birini kullanıyorsa, geçiş aracı kopya oluşturmak yerine üzerine yazar. Etiketleriniz korunur — eski temel etiket (örn. `#flashcards`) yapılandırdığınız Decks etiketine çevrilir.
4. **Ters kartlar iki karta dönüşür.** Bir `Front ::: Back` kartı, **aynı** deste dosyasında bir ileri kart ve bir takaslı kart olarak genişletilir; böylece her yön bağımsız olarak planlanır.
5. **İç içe yapı bağlama düzleştirilir.** SR, üst başlıkları ve iç içe liste maddelerini bir kartın bağlamı olarak ele alır. Decks bu yolun tamamını kartın ön yüzüne aktarır — örn. derin iç içe bir `Function :: Powerhouse`, `Cell Anatomy > Mitochondria > … > Function` olur — profilinizin tek başlık düzeyinde işlenir (yalnızca not başlığı olan bir H1 atlanır). Önceden yüklenmiş **Heading 1–6** profilleri aracılığıyla herhangi bir düzeyi seçin.
6. **Akıllı otomatik yönlendirme en iyi düzeni seçer.** Kısa tek satırlık kartlar derli toplu bir **tabloda** satır olur (kelime dağarcığı için sonsuz kaydırma yok); kod blokları, listeler veya matematik içeren çok satırlı kartlar, biçimlendirmelerinin korunması için **başlık** olur. Bunu iletişim kutusunda *tümü başlık* veya *tümü tablo* olarak geçersiz kılabilirsiniz.
7. **Tüm notu kapsayan tekrarlar da geçer.** Bir bütün olarak gözden geçirdiğiniz notlar (`#review` etiketi), özel bir `…/review` profili altında Decks **başlık modu** kartlarına dönüşür (dosya adı = ön yüz, tüm not = arka yüz). Planlamaları, notun `sr-*` frontmatter'ından veya dosya sonu işaretçisinden okunur.
8. **Planlama durumunuz FSRS-6'ya çevrilir.** Decks eski `<!--SR:-->` meta verilerini okur — SM-2 (`due, interval, ease`) veya zaten FSRS — ve bunları bir stabilite/zorluk/vade durumuna eşler. Ters kartlar, tıpkı orijinal eklentinin sakladığı gibi **iki ayrı** geçmiş tutar (okuma ile hatırlama).
9. **Geçirilen her kart için bir tekrar günlüğü yazılır**, böylece kartlar Decks'te belirdiği an doğru tarihte doğru aralıkla zaten vadesi gelmiş olur — yeniden başlamazsınız, devam edersiniz.

İletişim kutusunda bir profil seçin (veya varsayılanı kullanın) — başlık düzeyi ve planlama ayarları geçirilen destelere uygulanır.

## Anki'den geçiş

Anki'den mi geçiyorsun? Tüm koleksiyonunu Decks'e taşıyabilirsin — **kartlarını, medyanı veya tekrar geçmişini kaybetmeden** — ve FSRS-6 ile çalışmaya devam edebilirsin.

Anki'de destenizi (veya tüm koleksiyonu) **`.apkg`** olarak dışa aktarın (**Dosya → Dışa Aktar**, biçim *Anki Deste Paketi*, **Medyayı dahil et** ve **Planlama bilgilerini dahil et** işaretli). Ardından deste panelinin araç çubuğundan içe aktarıcıyı açın veya **„Import from Anki"** komutunu çalıştırın, dosyayı ve bir hedef klasörü seçip içe aktarın. Hem eski hem de yeni (sıkıştırılmış) `.apkg` dışa aktarımları çalışır.

**Anki koleksiyonunuza asla dokunulmaz.** İçe aktarma eklemelidir: seçtiğiniz, `#decks/anki` etiketi altına yerleştirilen bir hedef klasöre yeni dosyalar yazar ve kaynak `.apkg`'yi olduğu gibi bırakır. Aynı dosyayı yeniden içe aktarmak, ürettiği dosyaların üzerine yazar ve medyalarını tazeler — yani istediğiniz zaman yeniden çalıştırabilirsiniz.

**Nasıl çalışır**

1. **`.apkg`'yi ve bir hedef klasörü seçin.** Decks onu bellekte açar, gömülü Anki koleksiyonunu (eski veya yeni sıkıştırılmış biçim) okur ve başvurulan her medya dosyasını kasanızdaki bir `media/` klasörüne kopyalar. Özgün Anki deste hiyerarşisi (`Üst::Alt`) klasörler olarak korunur.
2. **Her not türü temiz bir Decks kartına dönüşür.** Temel notlar kompakt bir **tablo** ile **başlıklar** arasında otomatik geçiş yapar; **cloze** boşlukları `==…==` vurgularına dönüşür — `$…$` MathJax içindeki cloze'lar dahil; **çok alanlı / şablonlu** notlar otomatik oluşturulan bir şablon alır; ve Anki **resim örtme** kartları yerel Decks örtmesi olarak gelir.
3. **Medya, matematik ve etiketler taşınır.** Ses ve görseller gömülür ve tekrarda oynatılır/işlenir; görseller özgün boyutunu korur; LaTeX/MathJax korunur; Anki etiketleriniz gruplanıp okunabilir bölümler halinde sıralanır.
4. **Planlama durumunuz FSRS-6'ya çevrilir.** Her kartın vade tarihi, aralığı ve kolaylığı — artı tüm Anki tekrar geçmişi — bir kararlılık/zorluk/vade durumuna eşlenir ve tekrar günlüğü olarak yazılır; böylece kartlar **doğru tarihte doğru aralıkla zaten vadesi gelmiş** görünür. Devam edersiniz, baştan başlamazsınız.
5. **Büyük, medya ağırlıklı desteler akıcı kalır.** Büyük bir deste otomatik olarak sınırlı, alt klasörlere ayrılmış dosyalara bölünür — hem kart sayısına hem de medya gömme sayısına göre — böylece binlerce ses klibi olan bir deste Obsidian'da yine de hızlı açılır. Daha küçük desteler tek dosya olarak kalır.
6. **Olup biteni izlersiniz.** Bir ilerleme çubuğu her aşamayı izler — koleksiyonu okuma, desteleri yazma, medyayı kopyalama, eşitleme ve tekrar geçmişini içe aktarma — böylece büyük bir içe aktarma bile asla takılmış görünmez.

İletişim kutusunda bir profil seçin (veya varsayılanı kullanın) — başlık düzeyi ve planlama ayarları, `#decks/anki` etiketi altına yerleştirilen içe aktarılan destelere uygulanır.

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

Bu proje **GNU Affero General Public License v3.0 veya sonrası** (AGPL-3.0-or-later) ile lisanslanmıştır.

Kısacası: bu yazılımı kullanmakta, değiştirmekte ve dağıtmakta özgürsünüz. Ancak yazılımı değiştirip
değişikliklerinizi dağıtırsanız — ya da değiştirip kullanıcılara bir ağ üzerinden sunarsanız — değiştirdiğiniz
kaynak kodu aynı AGPL-3.0 lisansı altında kamuya açık hâle getirmelisiniz.

Copyright (C) 2026 Xherdi Lika. Tam metin için [LICENSE](./LICENSE) dosyasına bakın.

---

> Bu çeviri bir taslaktır — düzeltmeler ve öneriler için issue tracker'a katkıda bulunabilirsiniz.
