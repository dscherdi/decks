# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · **Shqip** · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Kthe shënimet e tua të Obsidian në karta (flashcards). Asnjë sintaksë e veçantë. Asnjë pako e veçantë për të krijuar.**

Etiketo një skedar me `#decks`. Çdo titull që shkruani bëhet pjesa e përparme e një karte; çdo paragraf më poshtë bëhet pjesa e pasme. Tabelat, mbulimi i imazheve (image occlusion) dhe theksimet `==cloze==` funksionojnë në të njëjtën mënyrë. Planifikimi trajtohet nga FSRS — algoritmi modern i përsëritjes në hapësirë.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Shënimet e versionit](./release-notes/) · [Më bli një kafe](https://www.buymeacoffee.com/dscherdil0)

## Pse Decks

- **Shënimet tuaja janë tashmë pakoja.** Etiketo një skedar, çdo titull bëhet pjesa e përparme, çdo paragraf bëhet pjesa e pasme. Nëse vjen nga Anki, nuk ka asgjë për të shkruar dy herë.
- **Katër formate, asnjë sintaksë për të mësuar.** Titujt, tabelat me dy kolona, mbulimi i imazheve dhe `==cloze==` nga theksimet që tashmë përdorni.
- **Planifikim origjinal me FSRS.** Tre profile (Standard / Intensiv / I Trajnuar), objektiva të mbajtjes mend për çdo etiketë, pa ngarkesën e SM-2.
- **Rregullimi i algoritmit.** Optimizuesi me një klikim trajnon peshat e FSRS në historikun tuaj të rishikimit — planifikim më i mirë për kurbën tuaj të harrimit, e gjitha në pajisjen tuaj (client-side).
- **Sinkronizim i vërtetë me shumë pajisje.** Baza e të dhënave bashkohet automatikisht përmes iCloud/Dropbox — rishikoni në telefon dhe kompjuter, pa humbur historikun.
- **Ndërtuar për celular.** Ndërfaqe rishikimi e përshtatur për prekje, e vetëdijshme për zonën e sigurt (safe-area), e testuar çdo ditë në telefona.

## Fillim i shpejtë në 60 sekonda

1. Instalo **Decks** nga Shtojcat e Komunitetit (Community Plugins) dhe aktivizoje atë.
2. Hap çdo shënim. Shto `#decks` në frontmatter ose si etiketë brenda tekstit.
3. Shkruaj një titull, pastaj një paragraf poshtë tij. Përsërite këtë për sa karta të duash:

   ```markdown
   ---
   tags: [decks/anglisht]
   ---

   # Çfarë do të thotë "Hola" në anglisht?

   Hello.

   # Si thua "Faleminderit" në anglisht?

   Thank you.
   ```

4. Kliko tek **ikona e trurit** në shiritin anësor për të hapur panelin Decks. Kliko në skedarin tënd. Fillo rishikimin.

Emri i skedarit bëhet emri i pakos. Kartat sinkronizohen automatikisht kur ruan shënimin.

## Formatet e kartave

Decks mbështet katër mënyra për të shkruar karta. Zgjidh atë që përshtatet me mënyrën se si shkruan shënimet.

<details>
<summary><b>Titull + paragraf</b> — formati i paracaktuar. Çdo titull është pjesa e përparme, teksti poshtë është pjesa e pasme.</summary>

```markdown
---
tags: [decks/anglisht]
---

# Çfarë do të thotë "Hola" në anglisht?

Hello.

# Si thua "Faleminderit" në anglisht?

Thank you.
```

Emri i skedarit bëhet emri i pakos. Niveli i titullit mund të konfigurohet për çdo profil.

</details>

<details>
<summary><b>Tabelat</b> — tabela markdown me dy kolona, me një kolonë opsionale për shënime.</summary>

```markdown
## Konceptet

| Pyetja                   | Përgjigja                                      |
| ------------------------ | ---------------------------------------------- |
| Çfarë është fotosinteza? | Procesi që përdorin bimët për të kthyer dritën |
| Përcakto gravitetin      | Forca që tërheq objektet drejt njëri-tjetrit   |
```

- Kolona e parë = para, kolona e dytë = prapa. Rreshti i titullit të tabelës shpërfillet.
- Tabelat duhet të qëndrojnë direkt poshtë një titulli (pa asnjë paragraf tjetër ndërmjet).
- Shto një kolonë të tretë "Shënime" për të dhëna/ndihmëza të cilat shfaqen duke shtypur **N** gjatë rishikimit.

</details>

<details>
<summary><b>Boshllëqet (Cloze)</b> — thekso tekstin me <code>==tekst==</code> për ta fshehur atë.</summary>

```markdown
## Sistemi Diellor

==Dielli== është ylli në qendër të sistemit tonë diellor. Planeti më i afërt është ==Mërkuri==, dhe planeti më i madh është ==Jupiteri==.
```

Çdo theksim bëhet një kartë më vete. Gjatë rishikimit, boshllëku aktiv shfaqet si `[...]`; preke për ta zbuluar. Funksionon edhe brenda qelizave të tabelave. I aktivizuar si parazgjedhje.

</details>

<details>
<summary><b>Mbulimi i imazhit (Image occlusion)</b> — një imazh plus një listë e numëruar.</summary>

```markdown
## Kockat e krahut

![[arm_bones.png]]

1. ==Humerusi==
2. ==Rrezori (Radius)==
3. ==Bërrylori (Ulna)==
```

Çdo element i listës është një kartë. Imazhi shfaqet përpara; elementi që përputhet fshihet prapa. Bazohet në tiparin "cloze".

</details>

### Pako canvas

Krijo karta në një Canvas të Obsidian (`.canvas`) në vend të një skedari Markdown. Çdo canvas brenda dosjes së konfiguruar bëhet një pako; çdo nyje teksti analizohet me të njëjtat katër formate karte më sipër. Konfiguro përmes **Cilësimet → Pako canvas**: dosja dhe etiketa (e paracaktuar `#decks/canvas`). "Shko te burimi" gjatë rishikimit hap canvas-in dhe fokuson nyjen burimore. Detaje në **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

## Planifikim i personalizuar

FSRS vjen me parazgjedhje të arsyeshme që funksionojnë shumë mirë që në fillim. Pasi të kesh grumbulluar rreth 100 rishikime, mund të trajnosh 21 peshat e algoritmit me historikun tënd dhe të marrësh planifikime të përshtatura posaçërisht për kurbën tënde të harrimit — e njëjta gjë që bën Anki në desktop, por në pajisjen tënde, pa server, pa gjurmim të dhënash.

**Cilësimet → Rregullimi i algoritmit → Optimizo parametrat.** Trajnimi zhvillohet në pak sekonda; do të shohësh një krahasim "log-loss" (para/pas). Kliko "Apliko" për të përdorur peshat e trajnuara.

## Shënimet e versionit & Mbështetja

- **Shënimet e versionit** për çdo përditësim ndodhen në [`release-notes/`](./release-notes/).
- **Diskuto në Discord** — [bashkohu në server](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Mbështet zhvillimin** — [Më bli një kafe](https://www.buymeacoffee.com/dscherdil0).
- **Udhëzuesi i përkthimit** - [Udhëzuesi i përkthimit](./docs/TRANSLATING.md).

## Licenca

Shiko [LICENSE](./LICENSE).

---

> Ky përkthim është një draft — kërkesat për tërheqje (Pull Requests) nga folësit amtarë janë të mirëseardhura.
