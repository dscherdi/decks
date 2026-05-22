# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · **Italiano** · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Trasforma le tue note di Obsidian in flashcard. Nessuna sintassi speciale. Nessun mazzo separato da costruire.**

Aggiungi il tag `#decks` a un file. Ogni intestazione che hai scritto diventa il fronte di una carta; ogni paragrafo sottostante diventa il retro. Le tabelle, l'occlusione d'immagine e le evidenziazioni `==cloze==` funzionano allo stesso modo. La pianificazione è gestita da FSRS, il moderno algoritmo di ripetizione dilazionata (spaced repetition).

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Note di rilascio](./release-notes/) · [Offrimi un caffè](https://www.buymeacoffee.com/dscherdil0)

## Perché Decks

- **Le tue note sono già il mazzo.** Tagga un file: ogni intestazione diventa un fronte, ogni paragrafo diventa un retro. Se vieni da Anki, non c'è nulla da scrivere due volte.
- **Quattro formati, nessuna sintassi da imparare.** Intestazioni, tabelle a due colonne, occlusione d'immagine e spazi vuoti `==cloze==` a partire dalle evidenziazioni che già usi.
- **Pianificazione nativa FSRS.** Tre profili (Standard / Intensivo / Allenato), target di ritenzione per tag, nessun fardello legato a SM-2.
- **Ottimizzazione dell'algoritmo.** L'ottimizzatore in un clic allena i pesi di FSRS sulla base della tua cronologia di ripasso: una pianificazione migliore per la tua specifica curva dell'oblio, tutto elaborato localmente (client-side).
- **Vera sincronizzazione multi-dispositivo.** Il database si unisce automaticamente tramite iCloud/Dropbox: ripassa su telefono e desktop, senza perdere lo storico.
- **Pensato per il mobile.** Interfaccia di ripasso ottimizzata per il touch, consapevole delle "safe-area", testata quotidianamente sugli smartphone.

## Avvio rapido in 60 secondi

1. Installa **Decks** dai Plugin della Community e abilitalo.
2. Apri qualsiasi nota. Aggiungi `#decks` nel suo frontmatter o come tag nel testo.
3. Scrivi un'intestazione, poi un paragrafo sotto di essa. Ripeti l'operazione per tutte le carte che desideri:

   ```markdown
   ---
   tags: [decks/inglese]
   ---

   # Cosa significa "Hola" in inglese?

   Hello.

   # Come si dice "Grazie" in inglese?

   Thank you.
   ```

4. Clicca sull'**icona del cervello** nella barra laterale per aprire il pannello di Decks. Clicca sul tuo file. Inizia a ripassare.

Il nome del file diventa il nome del mazzo. Le carte si sincronizzano automaticamente quando salvi la nota.

## Formati delle carte

Decks supporta quattro modi per scrivere le carte. Scegli quello che meglio si adatta al tuo modo di prendere appunti.

<details>
<summary><b>Intestazione + paragrafo</b> — il formato predefinito. Ogni intestazione è un fronte, il corpo sottostante è il retro.</summary>

```markdown
---
tags: [decks/inglese]
---

# Cosa significa "Hola" in inglese?

Hello.

# Come si dice "Grazie" in inglese?

Thank you.
```

Il nome del file diventa il nome del mazzo. Il livello di intestazione è configurabile per profilo.

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
<summary><b>Occlusione d'immagine</b> — un'immagine più un elenco numerato. I numeri sull'immagine corrispondono all'elenco.</summary>

```markdown
## Ossa del braccio

![[arm_bones.png]]

1. ==Omero==
2. ==Radio==
3. ==Ulna==
```

Ogni elemento dell'elenco è una carta. L'immagine (con le sue etichette numerate) viene mostrata sul fronte; l'elemento corrispondente viene oscurato sul retro. Si basa sugli spazi vuoti (cloze), quindi questa funzione deve essere abilitata nel profilo.

</details>

<details>
<summary><b>Altro: formato titolo, carte inverse, tag per carta</b></summary>

**Formato titolo** — il nome del file diventa il fronte, l'intero file diventa il retro. Imposta "Titolo" come livello di intestazione nel tuo profilo.

**Carte inverse** — aggiungi `reverse: true` nel frontmatter di un file per generare automaticamente una copia invertita di ogni carta. I progressi vengono monitorati separatamente per ogni direzione.

**Tag per carta** — aggiungi `#tag` direttamente nelle intestazioni (es. `## Cos'è la fotosintesi? #piante #scienza`). I tag vengono rimossi dal fronte visualizzato, mostrati come "chip" durante il ripasso ed ereditati dalle righe delle tabelle e dalle carte inverse. Crea "mazzi filtro" che includono ogni carta con un determinato tag in tutto il tuo vault.

</details>

### Mazzi canvas

Crea carte su un file Canvas di Obsidian (`.canvas`) anziché su un file Markdown. Ogni canvas nella cartella configurata diventa un mazzo; ogni nodo di testo viene analizzato con gli stessi quattro formati di carta sopra. Configura tramite **Impostazioni → Mazzi canvas**: cartella ed etichetta (predefinita `#decks/canvas`). "Vai alla sorgente" durante il ripasso apre il canvas e seleziona il nodo di origine. Dettagli in **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

## Pianificazione personalizzata

FSRS viene fornito con impostazioni predefinite logiche che funzionano benissimo fin da subito. Una volta accumulate circa 100 revisioni, puoi allenare i 21 pesi dell'algoritmo sulla tua cronologia e ottenere pianificazioni personalizzate per la tua specifica curva dell'oblio, proprio come fa Anki per desktop, ma tutto in locale, senza server e senza telemetria.

**Impostazioni → Ottimizzazione dell'algoritmo → Ottimizza parametri.** L'allenamento richiede pochi secondi per mazzi tipici; vedrai un confronto "log-loss" (prima e dopo). Clicca su "Applica" per usare i pesi allenati o "Scarta" per mantenere le impostazioni predefinite.

## Note di rilascio e Supporto

- Le **Note di rilascio** per ogni versione si trovano in [`release-notes/`](./release-notes/).
- **Partecipa su Discord** — [unisciti al server](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Sostieni lo sviluppo** — [Offrimi un caffè](https://www.buymeacoffee.com/dscherdil0).
- **Guida alla traduzione** - [Guida alla traduzione](./docs/TRANSLATING.md).

## Licenza

Vedi [LICENSE](./LICENSE).

---

> Questa traduzione è una bozza — le Pull Request da parte di madrelingua sono ben accette.
