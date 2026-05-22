# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · **Deutsch** · [Español](./README.es.md) · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Verwandle deine Obsidian-Notizen in Karteikarten. Keine spezielle Syntax. Kein separater Stapel zum Aufbauen.**

Markiere eine Datei mit `#decks`. Jede Überschrift, die du geschrieben hast, wird zur Vorderseite einer Karte; jeder Absatz darunter wird zur Rückseite. Tabellen, Bildverdeckung und `==cloze==`-Hervorhebungen funktionieren auf die gleiche Weise. Die Planung übernimmt FSRS — der moderne Algorithmus für räumliche Wiederholung.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Versionshinweise](./release-notes/) · [Spendier mir einen Kaffee](https://www.buymeacoffee.com/dscherdil0)

## Warum Decks

- **Deine Notizen sind bereits der Stapel.** Markiere eine Datei — jede Überschrift wird zur Vorderseite, jeder Absatz zur Rückseite. Wer von Anki kommt, muss nichts doppelt schreiben.
- **Vier Formate, keine Syntax zu lernen.** Überschriften, zweispaltige Tabellen, Bildverdeckung und `==cloze==` aus Hervorhebungen, die du bereits verwendest.
- **FSRS-native Planung.** Drei Profile (Standard / Intensiv / Trainiert), Retentionsziele pro Tag, kein SM-2-Ballast.
- **Algorithmus-Feinabstimmung.** Ein-Klick-Optimierer trainiert die FSRS-Gewichte auf deinem eigenen Wiederholungsverlauf — bessere Planung für deine persönliche Vergessenskurve, vollständig clientseitig.
- **Echte Multi-Geräte-Synchronisierung.** Die Datenbank verbindet sich automatisch über iCloud/Dropbox — wiederhole auf Handy und Desktop, ohne dass dein Verlauf verloren geht.
- **Für Mobilgeräte entwickelt.** Touch-optimierte Wiederholungs-UI, Safe-Area-bewusst, täglich auf Smartphones getestet.

## 60-Sekunden-Schnellstart

1. Installiere **Decks** aus den Community-Plugins und aktiviere es.
2. Öffne eine beliebige Notiz. Füge `#decks` in das Frontmatter oder als Inline-Tag ein.
3. Schreibe eine Überschrift, dann einen Absatz darunter. Wiederhole das für so viele Karten wie du möchtest:

   ```markdown
   ---
   tags: [decks/spanisch]
   ---

   # Was bedeutet "Hola"?

   Hallo.

   # Wie sagt man "Danke" auf Spanisch?

   Gracias.
   ```

4. Klicke auf das **Hirn-Symbol** in der Seitenleiste, um das Decks-Panel zu öffnen. Klicke auf deine Datei. Beginne mit dem Wiederholen.

Der Dateiname wird zum Stapelnamen. Karten synchronisieren sich automatisch, wenn du die Notiz speicherst.

## Kartenformate

Decks unterstützt vier Arten, Karten zu schreiben. Wähle die, die deinem Stil am besten entspricht.

<details>
<summary><b>Überschrift + Absatz</b> — der Standard. Jede Überschrift ist eine Vorderseite, der darunterliegende Text die Rückseite.</summary>

```markdown
---
tags: [decks/spanisch]
---

# Was bedeutet "Hola" auf Deutsch?

Hallo.

# Wie sagt man "Danke" auf Spanisch?

Gracias.
```

Der Dateiname wird zum Stapelnamen. Die Überschriftenebene ist pro Profil konfigurierbar.

</details>

<details>
<summary><b>Tabellen</b> — zweispaltige Markdown-Tabellen mit optionaler Notizen-Spalte.</summary>

```markdown
## Begriffe

| Frage                  | Antwort                                             |
| ---------------------- | --------------------------------------------------- |
| Was ist Photosynthese? | Der Prozess, mit dem Pflanzen Sonnenlicht umwandeln |
| Definiere Schwerkraft  | Die Kraft, die Objekte zueinander zieht             |
```

- Erste Spalte = Vorderseite, zweite Spalte = Rückseite. Die Kopfzeile wird ignoriert.
- Tabellen müssen direkt unter einer Überschrift stehen (keine anderen Absätze dazwischen).
- Füge eine dritte „Notizen"-Spalte für Hinweise/Eselsbrücken hinzu, die per Umschalter (Taste **N**) während der Wiederholung sichtbar werden.

</details>

<details>
<summary><b>Lückentexte</b> — hebe Text mit <code>==text==</code> hervor, um ihn auszublenden.</summary>

```markdown
## Das Sonnensystem

Die ==Sonne== ist der Stern im Zentrum unseres Sonnensystems. Der sonnennächste Planet ist ==Merkur==, und der größte Planet ist ==Jupiter==.
```

Jede Hervorhebung wird zu einer Karte. Während der Wiederholung wird die aktive Lücke als `[...]` angezeigt; tippe zum Aufdecken. Lücken funktionieren auch innerhalb von Tabellenzellen. Zwei Kontextmodi pro Profil (andere Lücken verbergen oder anzeigen). Standardmäßig aktiviert.

</details>

<details>
<summary><b>Bildverdeckung</b> — ein Bild plus eine nummerierte Liste. Nummern auf dem Bild sind mit der Liste verknüpft.</summary>

```markdown
## Knochen des Arms

![[arm_bones.png]]

1. ==Oberarmknochen==
2. ==Speiche==
3. ==Elle==
```

Jeder Listeneintrag ist eine Karte. Das Bild (mit seinen nummerierten Markierungen) wird auf der Vorderseite gezeigt; der passende Eintrag ist auf der Rückseite ausgeblendet. Baut auf Lückentexten auf, daher muss Cloze im Profil aktiviert sein.

</details>

<details>
<summary><b>Mehr: Titelformat, umgekehrte Karten, Tags pro Karte</b></summary>

**Titelformat** — der Dateiname wird zur Vorderseite, die gesamte Datei zur Rückseite. Setze „Titel" als Überschriftenebene in deinem Profil.

**Umgekehrte Karten** — füge `reverse: true` zum Frontmatter einer Datei hinzu, um automatisch eine umgekehrte Kopie jeder Karte zu erstellen. Der Fortschritt wird pro Richtung separat verfolgt.

**Tags pro Karte** — füge `#tag` direkt in Überschriften ein (z. B. `## Was ist Photosynthese? #pflanzen #gymnasium`). Tags werden aus der angezeigten Vorderseite entfernt, während der Wiederholung als Chips angezeigt und auf Tabellenzeilen sowie umgekehrte Karten übertragen. Erstelle „Filter-Stapel", die jede Karte mit einem bestimmten Tag aus deinem gesamten Vault zusammenführen.

</details>

### Canvas-Stapel

Erstelle Karten auf einer Obsidian-Canvas-Datei (`.canvas`) statt in einer Markdown-Datei. Jedes Canvas im konfigurierten Ordner wird zu einem Stapel; jeder Textknoten darin wird mit denselben vier Karten-Formaten oben analysiert. Konfiguration unter **Einstellungen → Canvas-Stapel**: Canvas-Ordner und Canvas-Stapel-Tag (Standard `#decks/canvas`). „Quelle öffnen" beim Review öffnet das Canvas und fokussiert den entsprechenden Textknoten. Beim ersten Installieren (oder Aktualisieren) wird automatisch ein `Decks — Canvas Erste Schritte.canvas` im Ordner `Canvas decks/` erstellt. Details in **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

## Was du bekommst

- Durchsuchen-Modus und zeitlich begrenzte Wiederholungssitzungen mit Tageslimits.
- Profile pro Tag (Standard / Intensives FSRS, Retentionsziel, Tagesquoten).
- Benutzerdefinierte Stapel aus Filterregeln — z. B. jede Karte mit dem Tag `#gymnasium`.
- Statistiken: Heatmap, Retention, Vorhersage zukünftiger Fälligkeiten, Intervalle, stündliche Aufschlüsselung, Antwortschaltflächen-Statistik.
- Anki-Export, automatische Sicherungen, Multi-Geräte-Merge-Sync.
- Tastenkürzel: **Leertaste** zum Umdrehen, **1–4** zum Bewerten.

## Multi-Geräte-Sync

Decks synchronisiert sich zusammen mit deinem Vault — iCloud Drive, Obsidian Sync, Dropbox, Syncthing — alles, was den Vault-Ordner teilt, funktioniert.

Das Plugin verwendet zwei Dateien:

- **`<Plugin-Ordner>/flashcards.db`** — die SQLite-Datenbank mit dem FSRS-Status jeder Karte und dem vollständigen Wiederholungsverlauf. Dies ist der Cold-Storage-Snapshot, der etwa alle 30 Minuten bei neuer Aktivität auf die Festplatte geschrieben wird (sowie beim Wechsel in den Hintergrund / Entladen der App).
- **`<deviceId>.deckssynclog`** — eine kleine, nur-anhängende JSONL-Datei pro Gerät im Vault-Stammverzeichnis. Jede Zustandsänderung — Bewertung einer Karte, Bearbeitung eines Profils, Erstellen eines benutzerdefinierten Stapels, Start/Ende einer Wiederholungssitzung — wird hier als eine kurze Zeile aufgezeichnet. Andere Geräte lesen diese Dateien beim Fokus der App und spielen die Einträge in ihrer eigenen Datenbank ab.

Die benutzerdefinierte Endung `.deckssynclog` hält die Datei aus Obsidians Datei-Explorer fern; du siehst sie im Finder/Dateien, aber sie erscheint nie als Notiz. iCloud und andere Datei-Sync-Anbieter übertragen diese kleinen Textdateien **erheblich schneller** als die binäre Datenbank — typischerweise Sekunden statt Minuten — weshalb die geräteübergreifende Verzögerung („Ich habe das gerade auf meinem Mac bewertet, jetzt sehe ich es auf dem iPhone") meist etwa 15–30 Sekunden statt 1–2 Minuten beträgt.

Das Log kürzt sich beim Laden des Plugins automatisch auf die letzten 30 Tage. Langlaufender, geräteübergreifender Zustand (Monate oder Jahre an Wiederholungsverlauf) wird in der binären Datenbank aufbewahrt, die nach ihrem eigenen, langsameren Zeitplan über deinen Datei-Sync-Anbieter synchronisiert wird.

Falls dein Sync-Anbieter Konfliktdateien anlegt (z. B. iCloud `<deviceId> (Macs konfliktbehaftete Kopie 2026-05-13).deckssynclog`), erkennt das Plugin sie, übernimmt die einzigartigen Einträge und benennt das Original in `*.consumed-<timestamp>` um, damit es nicht erneut verarbeitet wird.

## Personalisierte Planung

FSRS wird mit sinnvollen Standardwerten ausgeliefert, die direkt gut funktionieren. Sobald du etwa 100 Wiederholungen gesammelt hast, kannst du die 21 Gewichte des Algorithmus auf deinem eigenen Wiederholungsverlauf trainieren und Karten-Pläne erhalten, die auf deine spezifische Vergessenskurve zugeschnitten sind — ähnlich wie Anki-Desktop es macht, aber clientseitig, ohne Server, ohne Telemetrie.

**Einstellungen → Algorithmus-Feinabstimmung → Parameter optimieren.** Das Training läuft bei typischen Stapeln in Sekunden; du siehst einen Vorher-Nachher-Log-Loss-Vergleich, klicke „Anwenden", um die trainierten Gewichte zu nutzen, oder „Verwerfen", um die Standardwerte beizubehalten. Du kannst jederzeit erneut trainieren, um die Gewichte zu verfeinern, wenn du mehr Wiederholungen sammelst.

Trainierte Gewichte sind global, werden aber pro Profil angewendet — wähle **Trainiert** im FSRS-Profil-Dropdown eines Profils, um es zu aktivieren. Intensive Profile nutzen weiterhin ihre Sub-Tages-Standardwerte; vorhandene Kartendaten bleiben durch das Training erhalten.

<details>
<summary>Wie es unter der Haube funktioniert</summary>

Der Optimierer entspricht der Open-Spaced-Repetition-Referenzmethodik: Adam-Optimierer über Binary-Cross-Entropy-Verlust, kosinus-annealing-Lernrate, Parameter-Clipping gegen die veröffentlichten FSRS-6-Grenzwerte. Die Anzahl der Schritte skaliert mit deinem Wiederholungsverlauf (mehr Wiederholungen → mehr Iterationen).

Die Implementierung wurde gegen die veröffentlichte FSRS-6-Spezifikation validiert (1396/1396 Forward-Pass-Fälle stimmen bitgenau überein) und gegen 443M anonymisierte Anki-Wiederholungen benchmarkt — die Kalibrierung der mitgelieferten Standardwerte stimmt mit der empirischen Wiedererkennung auf 0,8 Prozentpunkte überein. Siehe [docs/FSRS_OPTIMIZER.md](./docs/FSRS_OPTIMIZER.md) für die vollständige Beschreibung: Vergleich mit dem Referenz-Benchmark, was bei unterschiedlichen Stapelgrößen zu erwarten ist und bekannte Einschränkungen.

</details>

## Einstellungen

Öffne **Einstellungen → Decks** für Tageslimits, Retentionsziele, Suchpfade, Sitzungsdauer und Backup-Optionen. Tag-spezifische Überschreibungen über das Zahnrad-Symbol auf jedem Stapel.

<details>
<summary>Alle Einstellungen</summary>

**Profil-Einstellungen** (Profile verwalten im Stapel-Panel):

- Neue Karten pro Tag, Wiederholungskarten pro Tag (pro Stapel)
- Retentionsziel (Standard 90%)
- FSRS-Profil: Standard, Intensiv oder Trainiert (Trainiert verfügbar nach Parameter-Optimierung)
- Überschriftenebene für das Parsen (oder „Titel", um den Dateinamen zu verwenden)
- Wiederholungsreihenfolge: älteste fällige zuerst oder zufällig
- Lückentexte: standardmäßig aktiviert
- Lücken-Kontext: verborgen oder offen

**Wiederholungs-Einstellungen:** Sitzungsdauer (1–60 Min), Tageswechselstunde (Standard 4 Uhr morgens), Schalter für Tastenkürzel.

**Parsing-Einstellungen:** den gesamten Vault scannen oder auf einen Ordner beschränken.

**Sonstiges:** Hintergrund-Aktualisierungsintervall, Anzahl automatischer Backups, Debug-Logging.

</details>

## Versionshinweise & Support

- **Versionshinweise** für jede Version findest du in [`release-notes/`](./release-notes/).
- **Diskutiere auf Discord** — [tritt dem Server bei](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Unterstütze die Entwicklung** — [Spendier mir einen Kaffee](https://www.buymeacoffee.com/dscherdil0).
- **Übersetzungsleitfaden** - [Übersetzungsleitfaden](./docs/TRANSLATING.md).

## Lizenz

Siehe [LICENSE](./LICENSE).

---

> Diese Übersetzung ist ein Entwurf — Pull Requests von Muttersprachlern sind willkommen.
