# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · **Italiano** · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Trasforma le tue note di Obsidian in flashcard. Nessuna sintassi speciale. Nessun mazzo separato da costruire.**

Aggiungi il tag `#decks` a un file. Ogni intestazione `##` diventa il fronte di una carta; il testo sottostante diventa il retro. Le tabelle, l'occlusione d'immagine e le evidenziazioni `==cloze==` funzionano allo stesso modo. La pianificazione è gestita da FSRS-6, il moderno algoritmo di ripetizione dilazionata (spaced repetition).

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Note di rilascio](./release-notes/) · [Offrimi un caffè](https://www.buymeacoffee.com/dscherdil0)

## Perché Decks

- **Le tue note sono già il mazzo.** Tagga un file: ogni intestazione al livello che scegli diventa un fronte e il testo sottostante diventa un retro. Se vieni da Anki, non c'è nulla da scrivere due volte.
- **Quattro formati, nessuna sintassi da imparare.** Intestazioni, tabelle a due colonne, occlusione d'immagine e spazi vuoti `==cloze==` a partire dalle evidenziazioni che già usi.
- **Pianificazione nativa FSRS.** Tre profili (Standard / Intensivo / Allenato), target di ritenzione per tag, nessun fardello legato a SM-2.
- **Ottimizzazione dell'algoritmo.** L'ottimizzatore in un clic allena i pesi di FSRS sulla base della tua cronologia di ripasso: una pianificazione migliore per la tua specifica curva dell'oblio, tutto elaborato localmente (client-side).
- **Vera sincronizzazione multi-dispositivo.** Il database si unisce automaticamente tramite iCloud/Dropbox: ripassa su telefono e desktop, senza perdere lo storico.
- **Pensato per il mobile.** Interfaccia di ripasso ottimizzata per il touch, consapevole delle "safe-area", testata quotidianamente sugli smartphone.

## Avvio rapido in 60 secondi

1. Installa **Decks** dai Plugin della Community e abilitalo.
2. Apri qualsiasi nota. Aggiungi `#decks` nel suo frontmatter o come tag nel testo.
3. Scrivi un'intestazione `##`, poi un paragrafo sotto di essa. Ripeti l'operazione per tutte le carte che desideri:

   ```markdown
   ---
   tags: [decks/inglese]
   ---

   ## Cosa significa "Hola" in inglese?

   Hello.

   ## Come si dice "Grazie" in inglese?

   Thank you.
   ```

4. Clicca sull'**icona del cervello** nella barra laterale per aprire il pannello di Decks. Clicca sul tuo file. Inizia a ripassare.

Il nome del file diventa il nome del mazzo. Le carte si sincronizzano automaticamente quando salvi la nota.

## Formati delle carte

Decks supporta quattro modi per scrivere le carte. Scegli quello che meglio si adatta al tuo modo di prendere appunti.

<details>
<summary><b>Intestazione + paragrafo</b> — il formato predefinito. Ogni intestazione al livello configurato (H2 per impostazione predefinita) è un fronte; il corpo sottostante è il retro.</summary>

```markdown
---
tags: [decks/inglese]
---

## Cosa significa "Hola" in inglese?

Hello.

## Come si dice "Grazie" in inglese?

Thank you.
```

Il nome del file diventa il nome del mazzo. Il livello di intestazione è configurabile per profilo (H2 per impostazione predefinita). Le intestazioni di livello superiore a quello configurato non diventano carte: vengono mantenute come percorso breadcrumb (es. `Capitolo 1 > Sezione 2`) allegato a ogni carta per il contesto.

Aggiungi **note** opzionali a una carta intestazione+paragrafo con un commento di Obsidian (`%%un suggerimento%%`) ovunque nel corpo, o dopo un separatore `---` alla fine. Le note vengono mostrate su richiesta (tasto **N**) durante il ripasso.

</details>

<details>
<summary><b>Tabelle</b> — tabelle markdown a due colonne, con una colonna opzionale per le note.</summary>

```markdown
## Concetti

| Domanda               | Risposta                                              |
| --------------------- | ----------------------------------------------------- |
| Cos'è la fotosintesi? | Il processo usato dalle piante per convertire la luce |
| Definisci la gravità  | La forza che attrae gli oggetti l'uno verso l'altro   |
```

- Prima colonna = fronte, seconda colonna = retro. La riga di intestazione viene ignorata.
- Le tabelle devono trovarsi direttamente sotto un'intestazione (senza altri paragrafi intermedi).
- Aggiungi una terza colonna "Note" per suggerimenti/mnemotecniche da visualizzare premendo **N** durante il ripasso.

</details>

<details>
<summary><b>Spazi vuoti (Cloze)</b> — evidenzia il testo con <code>==testo==</code> per oscurarlo.</summary>

```markdown
## Il sistema solare

Il ==Sole== è la stella al centro del nostro sistema solare. Il pianeta più vicino è ==Mercurio==, e il più grande è ==Giove==.
```

Ogni testo evidenziato diventa una carta. Durante il ripasso, lo spazio vuoto attivo viene mostrato come `[...]`; tocca per rivelarlo. Funziona anche all'interno delle celle di una tabella. Ci sono due modalità di contesto per profilo (nascondi o mostra gli altri spazi vuoti). Abilitato di default.

</details>

<details>
<summary><b>Occlusione d'immagine</b> — nascondi regioni di un'immagine e ricorda cosa c'è sotto. Due modi: interattivo (disegnare riquadri) o un elenco numerato.</summary>

**Interattivo (consigliato).** Esegui il comando **«Crea occlusione immagine al cursore»**, scegli un'immagine, poi disegna i riquadri direttamente nell'editor. Inserisci una risposta in Markdown/LaTeX per ogni riquadro, oppure lascialo vuoto per nascondere solo un'etichetta già presente nell'immagine. Viene salvato come un blocco di codice `decks-occlusion` autonomo (le coordinate sono in percentuale, quindi si adatta a qualsiasi dispositivo):

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
    answer: "**Ventricolo** sinistro"
  - id: m2
    x: 55
    y: 22
    w: 14
    h: 8
    answer: ""
```
````

Ogni riquadro è una carta. Durante il ripasso, il riquadro è nascosto sul fronte e rivelato sul retro (con la sua risposta); nella vista di lettura vedi il diagramma completamente etichettato. Modificabile in qualsiasi momento dal pulsante **Modifica** del blocco o dal gestore delle carte.

**Elenco numerato (semplice).** Anche un'immagine incorporata seguita da un elenco numerato funziona:

```markdown
## Ossa del braccio

![[arm_bones.png]]

1. ==Omero==
2. ==Radio==
3. ==Ulna==
```

Ogni elemento dell'elenco è una carta; l'immagine viene mostrata sul fronte e l'elemento corrispondente viene oscurato sul retro.

Entrambi si basano sugli spazi vuoti (cloze), quindi cloze deve essere abilitato nel profilo e il blocco deve trovarsi sotto un'intestazione analizzata.

</details>

<details>
<summary><b>Altro: formato titolo, carte inverse, tag per carta</b></summary>

**Formato titolo** — il nome del file diventa il fronte, l'intero file diventa il retro. Imposta "Titolo" come livello di intestazione nel tuo profilo.

**Carte inverse** — aggiungi `reverse: true` nel frontmatter di un file per generare automaticamente una copia invertita di ogni carta. I progressi vengono monitorati separatamente per ogni direzione.

**Tag per carta** — aggiungi `#tag` direttamente nelle intestazioni (es. `## Cos'è la fotosintesi? #piante #scienza`). I tag vengono rimossi dal fronte visualizzato, mostrati come "chip" durante il ripasso ed ereditati dalle righe delle tabelle e dalle carte inverse. Crea "mazzi filtro" che includono ogni carta con un determinato tag in tutto il tuo vault.

</details>

### Mazzi canvas

Crea carte su un file Canvas di Obsidian (`.canvas`) anziché su un file Markdown. Ogni canvas nella cartella configurata diventa un mazzo; ogni nodo di testo viene analizzato con gli stessi quattro formati di carta sopra. Configura tramite **Impostazioni → Mazzi canvas**: cartella ed etichetta (predefinita `#decks/canvas`). "Vai alla sorgente" durante il ripasso apre il canvas e seleziona il nodo di origine. Alla prima installazione (o aggiornamento) viene creato automaticamente un `Decks — Inizia con canvas.canvas` nella cartella `Canvas decks/`.

**Carte spaziali (Spatial cards)**: collega i nodi di testo con delle frecce — ogni freccia diventa una carta: il nodo di partenza è il fronte (domanda), il nodo di arrivo è il retro (risposta), e l'etichetta della freccia è un suggerimento opzionale. Funzionano catene (A → B → C), relazioni uno-a-molti e molti-a-uno; i nodi non collegati vengono comunque analizzati con i quattro formati sopra. Dettagli in **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

![Canvas Spatial Cards Demo](./canvas_spatial_cards_demo.gif)

## Modelli

Renderizza le righe di una tabella tramite un design di carta che crei una sola volta. Scrivilo in HTML/CSS o
Markdown, inserisci i segnaposto `{{Column}}` e collegalo alle tue tabelle con un tag: un modello dà stile a
ogni riga corrispondente.

```decks-html-front
<ruby>{{Word}}<rt>{{Reading}}</rt></ruby>
```

In **Impostazioni → Modelli** scegli una cartella, poi assegna lo stesso tag al file del modello e
all'intestazione della tabella: fatto. I modelli supportano le facce fronte/retro/note in HTML o Markdown,
vengono renderizzati in un ambiente isolato, sanificato e consapevole del tema, ed espongono variabili CSS
(`--padding`, `--align`, `--bg`, …) per il pieno controllo del layout — da comode carte di lettura a design
personalizzati a tutto campo. Le tabelle senza un modello corrispondente usano le colonne normali.

Vedi **[docs/TEMPLATES.md](docs/TEMPLATES.md)** per la guida completa ed esempi.

## Pianificazione personalizzata

FSRS viene fornito con impostazioni predefinite logiche che funzionano benissimo fin da subito. Una volta accumulate circa 100 revisioni, puoi allenare i 21 pesi dell'algoritmo sulla tua cronologia e ottenere pianificazioni personalizzate per la tua specifica curva dell'oblio, proprio come fa Anki per desktop, ma tutto in locale, senza server e senza telemetria.

**Impostazioni → Ottimizzazione dell'algoritmo → Ottimizza parametri.** L'allenamento richiede pochi secondi per mazzi tipici; vedrai un confronto "log-loss" (prima e dopo). Clicca su "Applica" per usare i pesi allenati o "Scarta" per mantenere le impostazioni predefinite.

## Migrazione da Spaced Repetition

Usi già il plugin **Spaced Repetition**? Puoi passare a Decks **senza perdere le tue carte o la cronologia delle ripetizioni** — e continuare le ripetizioni esattamente da dove le avevi lasciate.

Apri il migratore dalla barra degli strumenti del pannello dei mazzi (l'icona del cubo) oppure esegui il comando **"Migrate from Spaced Repetition plugin"**.

**Le tue note originali non vengono mai toccate.** La migrazione è additiva: scrive nuovi file in una cartella di destinazione che scegli tu (rispecchiando la tua struttura) e lascia le note di origine esattamente come sono. Rieseguire il migratore si limita a sovrascrivere i file che ha generato.

**Come funziona**

1. **Scegli una cartella di origine** da analizzare (oppure lasciala vuota per analizzare l'intero vault) e una cartella di destinazione per l'output. Decks trova ogni nota con carte legacy — su riga singola (`Front :: Back`), invertite (`Front ::: Back`), su più righe (`?` / `??`), cloze (`==…==` / `{{…}}`) — e le ripetizioni dell'intera nota (il tag `#review`).
2. **Ogni nota viene suddivisa in due file puliti.** Un **mazzo di flashcard** (`<Nota> (Flashcard)`) contiene le carte estratte nel formato standard di Decks, mentre una **nota leggibile** conserva il testo — con la sintassi delle carte *normalizzata* in testo normale (`::` / `:::` diventano " — ", `?` / `??` uniscono domanda e risposta e le cloze `==…==` / `{{…}}` vengono ripristinate alla loro risposta). I separatori che hai configurato vengono rispettati, quindi funziona anche se li hai personalizzati. Nulla viene rimosso — la tua nota di lettura resta completa.
3. **I file vengono collegati tra loro nel frontmatter.** La nota leggibile riceve una proprietà `Flashcard` che punta al suo mazzo e una proprietà `Nota di origine` che rimanda all'originale; anche il mazzo riceve una proprietà `Nota di origine`. Se una nota usa già uno di quei nomi di proprietà, il migratore lo sovrascrive invece di creare un duplicato. I tuoi tag vengono preservati — il tag base legacy (es. `#flashcards`) viene tradotto nel tag Decks che hai configurato.
4. **Le carte invertite diventano due carte.** Una carta `Front ::: Back` viene espansa in una carta diretta e una carta invertita nello **stesso** file del mazzo, così ogni direzione viene pianificata in modo indipendente.
5. **La struttura annidata viene appiattita in contesto.** SR tratta le intestazioni superiori e gli elenchi puntati annidati come contesto di una carta. Decks cattura l'intero percorso nel fronte della carta — ad esempio una `Function :: Powerhouse` profondamente annidata diventa `Cell Anatomy > Mitochondria > … > Function` — visualizzato al singolo livello di intestazione del tuo profilo (un H1 isolato che è il titolo della nota viene omesso). Scegli qualsiasi livello tramite i profili preinstallati **Heading 1–6**.
6. **L'instradamento automatico intelligente sceglie il layout migliore.** Le carte brevi su riga singola diventano righe in una **tabella** compatta (niente scorrimento infinito per il vocabolario); le carte su più righe — con blocchi di codice, elenchi o formule matematiche — diventano **intestazioni** così che la loro formattazione sopravviva. Puoi forzare *tutte intestazioni* o *tutte tabelle* nella finestra di dialogo.
7. **Anche le ripetizioni dell'intera nota vengono migrate.** Le note che hai ripetuto nella loro interezza (il tag `#review`) diventano carte Decks in **modalità titolo** (nome del file = fronte, intera nota = retro) sotto un profilo dedicato `…/review`. La loro pianificazione viene letta dal frontmatter `sr-*` della nota o dal suo marcatore a fine file.
8. **Il tuo stato di pianificazione viene tradotto in FSRS-6.** Decks legge i metadati legacy `<!--SR:-->` — SM-2 (`due, interval, ease`) o già FSRS — e li mappa in uno stato di stabilità/difficoltà/scadenza. Le carte invertite mantengono **due cronologie separate** (lettura vs. richiamo), esattamente come le memorizzava il plugin originale.
9. **Un log di ripetizione viene scritto per ogni carta migrata**, così nel momento in cui le carte compaiono in Decks sono già in scadenza alla data corretta con l'intervallo corretto — riprendi, non ricominci.

Scegli un profilo nella finestra di dialogo (o usa quello predefinito) — il suo livello di intestazione e le sue impostazioni di pianificazione vengono applicati ai mazzi migrati.

## Note di rilascio e Supporto

- Le **Note di rilascio** per ogni versione si trovano in [`release-notes/`](./release-notes/).
- **Partecipa su Discord** — [unisciti al server](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Sostieni lo sviluppo** — [Offrimi un caffè](https://www.buymeacoffee.com/dscherdil0).
- **Guida alla traduzione** - [Guida alla traduzione](./docs/TRANSLATING.md).

## Assistenza IA (opzionale)

Funzioni IA opzionali, **disattivate finché non aggiungi una chiave del provider in Impostazioni → IA**:

- **Genera** — crea carte da un prompt (e note/immagini opzionali) e salvale in un nuovo file o in un mazzo esistente come intestazione+paragrafo, tabella o canvas.
- **Rielabora** una carta o un'intera selezione, oppure **dividi** una carta in più carte — rivedi ogni modifica prima di applicarla.

Usa la tua chiave per OpenAI, Anthropic (Claude), Google (Gemini) o un endpoint compatibile con OpenAI/locale. Le chiavi sono salvate localmente in `ai-keys.json` e non vengono mai scritte in `data.json`, quindi non lasciano il dispositivo tramite la sincronizzazione. Nulla viene inviato a un provider se non avvii un'azione; ogni richiesta contiene solo un prompt integrato su come funziona Decks, le tue istruzioni e il contenuto di quell'azione.

![Decks AI Generator](./decks_ai_generate.gif)

## Basato su

Decks è basato su **[`@decks/core`](https://github.com/dscherdi/decks-core)** — il motore open source (MIT) che implementa il parsing, la pianificazione FSRS, la sincronizzazione e l'orchestrazione IA. Il plugin è il guscio specifico per Obsidian che lo avvolge.

## Licenza

Questo progetto è rilasciato sotto la **GNU Affero General Public License v3.0 o successiva**
(AGPL-3.0-or-later).

In breve: sei libero di usare, modificare e distribuire questo software. Tuttavia, se lo modifichi e
distribuisci le tue modifiche — o lo modifichi e lo offri agli utenti tramite una rete — devi rendere il tuo
codice sorgente modificato pubblicamente disponibile sotto la stessa licenza AGPL-3.0.

Copyright (C) 2026 Xherdi Lika. Vedi il file [LICENSE](./LICENSE) per il testo completo.

---

> Questa traduzione è una bozza — correzioni e suggerimenti sono benvenuti nell'issue tracker.
