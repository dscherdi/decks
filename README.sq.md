# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · **Shqip** · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Kthe shënimet e tua të Obsidian në karta (flashcards). Asnjë sintaksë e veçantë. Asnjë pako e veçantë për të krijuar.**

Etiketo një skedar me `#decks`. Çdo titull `##` bëhet pjesa e përparme e një karte; teksti më poshtë bëhet pjesa e pasme. Tabelat, mbulimi i imazheve (image occlusion) dhe theksimet `==cloze==` funksionojnë në të njëjtën mënyrë. Planifikimi trajtohet nga FSRS-6 — algoritmi modern i përsëritjes në hapësirë.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Shënimet e versionit](./release-notes/) · [Më bli një kafe](https://www.buymeacoffee.com/dscherdil0)

## Pse Decks

- **Shënimet tuaja janë tashmë pakoja.** Etiketo një skedar: çdo titull në nivelin që zgjedh bëhet pjesa e përparme dhe teksti më poshtë bëhet pjesa e pasme. Nëse vjen nga Anki, nuk ka asgjë për të shkruar dy herë.
- **Katër formate, asnjë sintaksë për të mësuar.** Titujt, tabelat me dy kolona, mbulimi i imazheve dhe `==cloze==` nga theksimet që tashmë përdorni.
- **Planifikim origjinal me FSRS.** Tre profile (Standard / Intensiv / I Trajnuar), objektiva të mbajtjes mend për çdo etiketë, pa ngarkesën e SM-2.
- **Rregullimi i algoritmit.** Optimizuesi me një klikim trajnon peshat e FSRS në historikun tuaj të rishikimit — planifikim më i mirë për kurbën tuaj të harrimit, e gjitha në pajisjen tuaj (client-side).
- **Sinkronizim i vërtetë me shumë pajisje.** Baza e të dhënave bashkohet automatikisht përmes iCloud/Dropbox — rishikoni në telefon dhe kompjuter, pa humbur historikun.
- **Ndërtuar për celular.** Ndërfaqe rishikimi e përshtatur për prekje, e vetëdijshme për zonën e sigurt (safe-area), e testuar çdo ditë në telefona.

## Fillim i shpejtë në 60 sekonda

1. Instalo **Decks** nga Shtojcat e Komunitetit (Community Plugins) dhe aktivizoje atë.
2. Hap çdo shënim. Shto `#decks` në frontmatter ose si etiketë brenda tekstit.
3. Shkruaj një titull `##`, pastaj një paragraf poshtë tij. Përsërite këtë për sa karta të duash:

   ```markdown
   ---
   tags: [decks/anglisht]
   ---

   ## Çfarë do të thotë "Hola" në anglisht?

   Hello.

   ## Si thua "Faleminderit" në anglisht?

   Thank you.
   ```

4. Kliko tek **ikona e trurit** në shiritin anësor për të hapur panelin Decks. Kliko në skedarin tënd. Fillo rishikimin.

Emri i skedarit bëhet emri i pakos. Kartat sinkronizohen automatikisht kur ruan shënimin.

## Formatet e kartave

Decks mbështet katër mënyra për të shkruar karta. Zgjidh atë që përshtatet me mënyrën se si shkruan shënimet.

<details>
<summary><b>Titull + paragraf</b> — formati i paracaktuar. Çdo titull në nivelin e konfiguruar (H2 si parazgjedhje) është pjesa e përparme; teksti poshtë është pjesa e pasme.</summary>

```markdown
---
tags: [decks/anglisht]
---

## Çfarë do të thotë "Hola" në anglisht?

Hello.

## Si thua "Faleminderit" në anglisht?

Thank you.
```

Emri i skedarit bëhet emri i pakos. Niveli i titullit mund të konfigurohet për çdo profil (H2 si parazgjedhje). Titujt mbi nivelin e konfiguruar nuk shndërrohen në karta — ata ruhen si një shteg orientues (p.sh. `Kapitulli 1 > Seksioni 2`) i bashkangjitur çdo karte për kontekst.

Shto **shënime** opsionale në një kartë titull+paragraf me një koment Obsidian (`%%një ndihmesë%%`) kudo në trup, ose pas një ndarësi `---` në fund. Shënimet shfaqen sipas kërkesës (tasti **N**) gjatë rishikimit.

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
<summary><b>Mbulimi i imazhit (Image occlusion)</b> — fshih zona të një imazhi dhe kujto çfarë ndodhet poshtë. Dy mënyra: interaktive (vizato kuti) ose një listë e numëruar.</summary>

**Interaktive (e rekomanduar).** Ekzekuto komandën **«Krijo okluzion imazhi te kursori»**, zgjidh një imazh dhe pastaj vizato kuti drejtpërdrejt në redaktues. Shkruaj një përgjigje Markdown/LaTeX për çdo kuti, ose lëre bosh për të fshehur thjesht një etiketë të integruar. Ruhet si një bllok kodi `decks-occlusion` i vetëmjaftueshëm (koordinatat janë në përqindje, kështu që përshtatet në çdo pajisje):

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
    answer: "**Ventrikuli** i majtë"
  - id: m2
    x: 55
    y: 22
    w: 14
    h: 8
    answer: ""
```
````

Çdo kuti është një kartë. Gjatë përsëritjes, kutia është e fshehur përpara dhe zbulohet prapa (me përgjigjen e saj); në pamjen e leximit sheh diagramin plotësisht të etiketuar. Mund të modifikohet kurdoherë nga butoni **Modifiko** i bllokut ose nga menaxheri i kartave.

**Listë e numëruar (e thjeshtë).** Një imazh i integruar i ndjekur nga një listë e numëruar gjithashtu funksionon:

```markdown
## Kockat e krahut

![[arm_bones.png]]

1. ==Humerusi==
2. ==Rrezori (Radius)==
3. ==Bërrylori (Ulna)==
```

Çdo element i listës është një kartë; imazhi shfaqet përpara dhe elementi që përputhet fshihet prapa.

Të dyja bazohen në tiparin "cloze", prandaj cloze duhet të jetë i aktivizuar në profil dhe blloku duhet të jetë nën një titull që analizohet.

</details>

### Pako canvas

Krijo karta në një Canvas të Obsidian (`.canvas`) në vend të një skedari Markdown. Çdo canvas brenda dosjes së konfiguruar bëhet një pako; çdo nyje teksti analizohet me të njëjtat katër formate karte më sipër. Konfiguro përmes **Cilësimet → Pako canvas**: dosja dhe etiketa (e paracaktuar `#decks/canvas`). "Shko te burimi" gjatë rishikimit hap canvas-in dhe fokuson nyjen burimore. Në instalimin e parë (ose përditësimin), brenda dosjes `Canvas decks/` krijohet automatikisht një `Decks — Fillimi me canvas.canvas`.

**Karta hapësinore (Spatial cards)**: lidh nyjet e tekstit me brinjë — çdo brinjë bëhet një kartë: nyja e nisjes është pjesa e parme (pyetja), nyja e mbërritjes është pjesa e prapme (përgjigja), dhe etiketa e brinjës është një aluzion opsional. Zinxhirët (A → B → C), një-me-shumë dhe shumë-me-një funksionojnë të gjithë; nyjet e palidhura ende analizohen me katër formatet më sipër. Detaje në **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

![Canvas Spatial Cards Demo](./canvas_spatial_cards_demo.gif)

## Shabllonet

Shfaq rreshtat e një tabele përmes një dizajni karte që e krijon një herë. Shkruaje në HTML/CSS ose Markdown,
vendos mbajtëse `{{Column}}` dhe lidhe me tabelat e tua përmes një etikete — një shabllon i jep stil çdo
rreshti që përputhet.

```decks-html-front
<ruby>{{Word}}<rt>{{Reading}}</rt></ruby>
```

Te **Cilësimet → Shabllonet** zgjidh një dosje, etiketo skedarin e shabllonit dhe titullin e tabelës me të
njëjtën etiketë — gati. Shabllonet mbështesin anët ballë/prapa/shënime në HTML ose Markdown, shfaqen në një
mjedis të izoluar, të pastruar dhe të ndërgjegjshëm për temën, dhe ekspozojnë variabla CSS (`--padding`,
`--align`, `--bg`, …) për kontroll të plotë të paraqitjes — nga karta të rehatshme leximi te dizajne të
personalizuara buzë-më-buzë. Tabelat pa një shabllon që përputhet përdorin përsëri kolonat normale.

Shih **[docs/TEMPLATES.md](docs/TEMPLATES.md)** për udhëzuesin e plotë dhe shembuj.

## Planifikim i personalizuar

FSRS vjen me parazgjedhje të arsyeshme që funksionojnë shumë mirë që në fillim. Pasi të kesh grumbulluar rreth 100 rishikime, mund të trajnosh 21 peshat e algoritmit me historikun tënd dhe të marrësh planifikime të përshtatura posaçërisht për kurbën tënde të harrimit — e njëjta gjë që bën Anki në desktop, por në pajisjen tënde, pa server, pa gjurmim të dhënash.

**Cilësimet → Rregullimi i algoritmit → Optimizo parametrat.** Trajnimi zhvillohet në pak sekonda; do të shohësh një krahasim "log-loss" (para/pas). Kliko "Apliko" për të përdorur peshat e trajnuara.

## Po vini nga Spaced Repetition

A jeni duke përdorur tashmë shtojcën **Spaced Repetition**? Mund të kaloni te Decks **pa humbur kartat tuaja ose historikun tuaj të rishikimeve** — dhe të vazhdoni rishikimet tuaja pikërisht aty ku i latë.

Hapni migruesin nga shiriti i mjeteve i panelit të kuvertave (ikona e kubit) ose ekzekutoni komandën **"Migro nga shtojca Spaced Repetition"**.

**Shënimet tuaja origjinale nuk preken kurrë.** Migrimi është shtues: shkruan skedarë të rinj në një dosje të synuar që zgjidhni ju (duke pasqyruar strukturën tuaj) dhe i lë shënimet tuaja burimore pikërisht ashtu siç janë. Riekzekutimi i migruesit thjesht mbishkruan skedarët që ai gjeneroi.

**Si funksionon**

1. **Zgjidhni një dosje burimore** për të skanuar (ose lëreni bosh për të skanuar të gjithë kasafortën), dhe një dosje të synuar për rezultatin. Decks gjen çdo shënim me karta të vjetra — një rresht (`Front :: Back`), të kthyera (`Front ::: Back`), shumë rreshta (`?` / `??`), kloze (`==…==` / `{{…}}`) — dhe rishikime të të gjithë shënimit (etiketa `#review`).
2. **Çdo shënim ndahet në dy skedarë të pastër.** Një **kuvertë kartash** (`<Shënimi> (Kartat)`) mban kartat e nxjerra në formatin standard të Decks, dhe një **shënim i lexueshëm** ruan tekstin — me sintaksën e kartave të *de-sheqerosur* në tekst normal (`::` / `:::` bëhen " — ", `?` / `??` bashkojnë pyetjen dhe përgjigjen, dhe klozet `==…==` / `{{…}}` rikthehen te përgjigja e tyre). Ndarësit tuaj të konfiguruar respektohen, kështu që kjo funksionon edhe nëse i keni personalizuar ato. Asgjë nuk hiqet — shënimi juaj i leximit mbetet i plotë.
3. **Skedarët ndërlidhen me njëri-tjetrin në frontmatter.** Shënimi i lexueshëm merr një veti `Kartat` që tregon te kuverta e tij dhe një veti `Shënimi i origjinës` që tregon mbrapsht te origjinali; kuverta merr gjithashtu një veti `Shënimi i origjinës`. Nëse një shënim përdor tashmë një nga ato emra vetish, migruesi e mbishkruan atë në vend që të krijojë një dublikatë. Etiketat tuaja ruhen — etiketa bazë e vjetër (p.sh. `#flashcards`) përkthehet në etiketën tuaj të konfiguruar të Decks.
4. **Kartat e kthyera bëhen dy karta.** Një kartë `Front ::: Back` zgjerohet në një kartë përpara dhe një kartë të shkëmbyer në **të njëjtin** skedar kuverte, kështu që çdo drejtim planifikohet në mënyrë të pavarur.
5. **Struktura e ndërthurur sheshohet në kontekst.** SR i trajton kokat paraardhëse dhe pikat e listave të ndërthurura si kontekstin e një karte. Decks e kap të gjithë atë shteg në pjesën e përparme të kartës — p.sh. një `Function :: Powerhouse` thellësisht i ndërthurur bëhet `Cell Anatomy > Mitochondria > … > Function` — i renderuar në nivelin e vetëm të kokës të profilit tuaj (një H1 i vetëm i titullit të shënimit hiqet). Zgjidhni çdo nivel përmes profileve të parainstaluara **Heading 1–6**.
6. **Rrugëzimi automatik inteligjent zgjedh paraqitjen më të mirë.** Kartat e shkurtra me një rresht bëhen rreshta në një **tabelë** kompakte (pa rrëshqitje të pafundme për fjalorin); kartat me shumë rreshta — me blloqe kodi, lista ose matematikë — bëhen **koka** që formatimi i tyre të mbijetojë. Mund ta anuloni këtë te *të gjitha kokat* ose *të gjitha tabelat* në dialog.
7. **Rishikimet e të gjithë shënimit migrojnë gjithashtu.** Shënimet që i rishikuat si një të tërë (etiketa `#review`) bëhen karta të **modalitetit-titull** të Decks (emri i skedarit = pjesa e përparme, i gjithë shënimi = pjesa e pasme) nën një profil të dedikuar `…/review`. Plani i tyre lexohet nga frontmatter `sr-*` i shënimit ose shënuesi i tij në fund të skedarit.
8. **Gjendja juaj e planifikimit përkthehet në FSRS-6.** Decks lexon metadatat e vjetra `<!--SR:-->` — SM-2 (`due, interval, ease`) ose tashmë FSRS — dhe i hartëzon ato në një gjendje stabiliteti/vështirësie/afati. Kartat e kthyera mbajnë **dy historikë të veçantë** (leximi kundrejt kujtimit), pikërisht ashtu siç i ruante shtojca origjinale.
9. **Një ditar rishikimi shkruhet për çdo kartë të migruar**, kështu që në çastin që kartat shfaqen në Decks, ato janë tashmë në afat në datën e duhur me intervalin e duhur — ju rifilloni, nuk e nisni nga fillimi.

Zgjidhni një profil në dialog (ose përdorni atë të parazgjedhurin) — niveli i tij i kokës dhe cilësimet e planifikimit zbatohen te kuvertat e migruara.

## Shënimet e versionit & Mbështetja

- **Shënimet e versionit** për çdo përditësim ndodhen në [`release-notes/`](./release-notes/).
- **Diskuto në Discord** — [bashkohu në server](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Mbështet zhvillimin** — [Më bli një kafe](https://www.buymeacoffee.com/dscherdil0).
- **Udhëzuesi i përkthimit** - [Udhëzuesi i përkthimit](./docs/TRANSLATING.md).

## Ndihma me IA (opsionale)

Veçori opsionale me IA, **të çaktivizuara derisa të shtosh një çelës ofruesi te Cilësimet → IA**:

- **Krijo** — krijo karta nga një udhëzim (dhe shënime/imazhe opsionale) dhe ruaji në një skedar të ri ose në një kuvertë ekzistuese si titull+paragraf, tabelë ose kanavacë.
- **Ripërpuno** një kartë ose një përzgjedhje të tërë, ose **ndaj** një kartë në disa — çdo ndryshim e shqyrton para se të zbatohet.

Përdor çelësin tënd për OpenAI, Anthropic (Claude), Google (Gemini) ose një pikë-fundore të pajtueshme me OpenAI/lokale. Çelësat ruhen lokalisht në `ai-keys.json` dhe nuk shkruhen kurrë në `data.json`, ndaj nuk largohen nga pajisja jote përmes sinkronizimit. Asgjë nuk dërgohet te një ofrues nëse nuk nis një veprim; çdo kërkesë përmban vetëm një udhëzim të brendshëm se si funksionon Decks, udhëzimet e tua dhe përmbajtjen e atij veprimi.

![Decks AI Generator](./decks_ai_generate.gif)

## Ndërtuar mbi

Decks është ndërtuar mbi **[`@decks/core`](https://github.com/dscherdi/decks-core)** — motorin me kod të hapur (MIT) që zbaton analizimin, planifikimin FSRS, sinkronizimin dhe orkestrimin e IA-së. Shtojca është mbështjellësi specifik për Obsidian rreth tij.

## Licenca

Ky projekt licencohet sipas **GNU Affero General Public License v3.0 ose më vonë** (AGPL-3.0-or-later).

Shkurt: je i lirë ta përdorësh, ta modifikosh dhe ta shpërndash këtë softuer. Megjithatë, nëse e modifikon dhe
shpërndan ndryshimet e tua — ose e modifikon dhe ua ofron përdoruesve përmes një rrjeti — duhet ta bësh kodin
burim të modifikuar publikisht të disponueshëm sipas së njëjtës licencë AGPL-3.0.

Copyright (C) 2026 Xherdi Lika. Shih skedarin [LICENSE](./LICENSE) për tekstin e plotë.

---

> Ky përkthim është një draft — korrigjimet dhe sugjerimet janë të mirëseardhura te issue tracker.
