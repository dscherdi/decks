# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · **Français** · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Transformez vos notes Obsidian en cartes mémoire (flashcards). Aucune syntaxe spéciale. Aucun paquet séparé à construire.**

Ajoutez la balise `#decks` à un fichier. Chaque en-tête `##` devient le recto d'une carte ; le texte en dessous devient le verso. Les tableaux, les images masquées et les textes surlignés `==cloze==` fonctionnent de la même manière. La planification est gérée par FSRS-6 — l'algorithme moderne de répétition espacée.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Notes de version](./release-notes/) · [Offrez-moi un café](https://www.buymeacoffee.com/dscherdil0)

## Pourquoi Decks

- **Vos notes sont déjà le paquet.** Balisez un fichier : chaque en-tête au niveau que vous choisissez devient un recto et le texte en dessous devient un verso. Si vous venez d'Anki, il n'y a rien à rédiger deux fois.
- **Quatre formats, aucune syntaxe à apprendre.** En-têtes, tableaux à deux colonnes, masquage d'images et textes à trous `==cloze==` à partir des surlignages que vous utilisez déjà.
- **Planification native FSRS.** Trois profils (Standard / Intensif / Entraîné), cibles de rétention par balise, sans les contraintes de SM-2.
- **Ajustement de l'algorithme.** L'optimiseur en un clic entraîne les poids FSRS sur votre propre historique de révision — une meilleure planification pour votre courbe d'oubli, le tout côté client.
- **Véritable synchronisation multi-appareils.** La base de données fusionne automatiquement via iCloud/Dropbox — révisez sur téléphone et sur bureau, sans perte d'historique.
- **Conçu pour le mobile.** Interface de révision optimisée pour le tactile, adaptée aux zones sécurisées (safe-area), testée quotidiennement sur téléphones.

## Démarrage rapide en 60 secondes

1. Installez **Decks** depuis les plugins communautaires et activez-le.
2. Ouvrez n'importe quelle note. Ajoutez `#decks` dans le frontmatter ou comme balise dans le texte.
3. Écrivez un en-tête `##`, puis un paragraphe en dessous. Répétez l'opération pour autant de cartes que vous le souhaitez :

   ```markdown
   ---
   tags: [decks/anglais]
   ---

   ## Que signifie "Hola" en anglais ?

   Hello.

   ## Comment dit-on "Merci" en anglais ?

   Thank you.
   ```

4. Cliquez sur l'**icône de cerveau** dans la barre latérale pour ouvrir le panneau Decks. Cliquez sur votre fichier. Commencez à réviser.

Le nom du fichier devient le nom du paquet. Les cartes se synchronisent automatiquement lorsque vous sauvegardez la note.

## Formats de cartes

Decks propose quatre façons de rédiger vos cartes. Choisissez celle qui correspond le mieux à votre façon d'écrire.

<details>
<summary><b>En-tête + paragraphe</b> — le format par défaut. Chaque en-tête au niveau configuré (H2 par défaut) est un recto ; le corps en dessous est le verso.</summary>

```markdown
---
tags: [decks/anglais]
---

## Que signifie "Hola" en anglais ?

Hello.

## Comment dit-on "Merci" en anglais ?

Thank you.
```

Le nom du fichier devient le nom du paquet. Le niveau d'en-tête est configurable par profil (H2 par défaut). Les en-têtes au-dessus du niveau configuré ne deviennent pas des cartes — ils sont conservés sous forme de fil d'Ariane (par ex. `Chapitre 1 > Section 2`) attaché à chaque carte pour le contexte.

Ajoutez des **notes** facultatives à une carte titre+paragraphe avec un commentaire Obsidian (`%%un indice%%`) n'importe où dans le corps, ou après un séparateur `---` à la fin. Les notes s'affichent à la demande (touche **N**) pendant la révision.

</details>

<details>
<summary><b>Tableaux</b> — tableaux markdown à deux colonnes, avec une colonne optionnelle pour les notes.</summary>

```markdown
## Concepts

| Question                         | Réponse                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| Qu'est-ce que la photosynthèse ? | Le processus qu'utilisent les plantes pour convertir la lumière |
| Définir la gravité               | La force qui attire les objets les uns vers les autres          |
```

- Première colonne = recto, deuxième colonne = verso. La ligne d'en-tête est ignorée.
- Les tableaux doivent se trouver directement sous un en-tête (sans autres paragraphes à l'intérieur).
- Ajoutez une troisième colonne "Notes" pour les indices/moyens mnémotechniques, affichables en appuyant sur **N** pendant la révision.

</details>

<details>
<summary><b>Textes à trous (Cloze)</b> — surlignez du texte avec <code>==texte==</code> pour le masquer.</summary>

```markdown
## Le système solaire

Le ==Soleil== est l'étoile au centre de notre système solaire. La planète la plus proche est ==Mercure==, et la plus grande est ==Jupiter==.
```

Chaque surlignage devient une carte. Pendant la révision, le trou actif s'affiche sous la forme `[...]` ; touchez pour le révéler. Les textes à trous fonctionnent aussi dans les cellules des tableaux. Deux modes de contexte par profil (masquer ou afficher les autres trous). Activado por defecto.

</details>

<details>
<summary><b>Masquage d'image</b> — masquez des zones d'une image et retrouvez ce qu'il y a dessous. Deux méthodes : interactive (dessiner des zones) ou une liste numérotée.</summary>

**Interactive (recommandée).** Exécutez la commande **« Créer une occlusion d'image au curseur »**, choisissez une image, puis dessinez des zones directement dans l'éditeur. Saisissez une réponse Markdown/LaTeX pour chaque zone, ou laissez-la vide pour simplement masquer une étiquette intégrée. C'est enregistré comme un bloc de code `decks-occlusion` autonome (les coordonnées sont en pourcentages, donc cela s'adapte à tout appareil) :

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
    answer: "**Ventricule** gauche"
  - id: m2
    x: 55
    y: 22
    w: 14
    h: 8
    answer: ""
```
````

Chaque zone est une carte. En révision, la zone est masquée au recto et révélée au verso (avec sa réponse) ; en mode lecture, vous voyez le schéma entièrement annoté. Modifiable à tout moment depuis le bouton **Modifier** du bloc ou le gestionnaire de cartes.

**Liste numérotée (simple).** Une image intégrée suivie d'une liste numérotée fonctionne aussi :

```markdown
## Os du bras

![[arm_bones.png]]

1. ==Humérus==
2. ==Radius==
3. ==Ulna (Cubitus)==
```

Chaque élément de la liste est une carte ; l'image s'affiche au recto et l'élément correspondant est masqué au verso.

Les deux s'appuient sur les textes à trous (cloze), qui doivent donc être activés sur le profil, et le bloc doit se trouver sous un en-tête analysé.

</details>

<details>
<summary><b>Plus : format titre, cartes inversées, balises par carte</b></summary>

**Format titre** — le nom du fichier devient le recto, le fichier entier devient le verso. Définissez "Titre" comme niveau d'en-tête dans votre profil.

**Cartes inversées** — ajoutez `reverse: true` dans le frontmatter d'un fichier pour générer automatiquement une copie inversée de chaque carte. La progression est suivie séparément pour chaque sens.

**Balises par carte** — ajoutez `#balise` directement dans les en-têtes (ex. `## Qu'est-ce que la photosynthèse ? #plantes #lycée`). Les balises sont supprimées du recto affiché, apparaissent comme des puces pendant la révision, et sont héritées par les lignes de tableau et les cartes inversées. Créez des "paquets de filtres" qui regroupent toutes les cartes contenant une balise donnée dans l'ensemble de votre coffre (vault).

</details>

### Paquets canvas

Créez des cartes sur un canvas Obsidian (`.canvas`) au lieu d'un fichier Markdown. Chaque canvas dans le dossier configuré devient un paquet ; chaque nœud texte est analysé avec les mêmes quatre formats de carte ci-dessus. Configurez via **Paramètres → Paquets canvas** : dossier et étiquette (par défaut `#decks/canvas`). « Aller à la source » depuis la révision ouvre le canvas et met le focus sur le nœud d'origine. À la première installation (ou mise à jour), un fichier `Decks — Démarrer avec canvas.canvas` est créé automatiquement dans le dossier `Canvas decks/`.

**Cartes spatiales (Spatial cards)** : reliez des nœuds texte par des arêtes — chaque arête devient une carte : le nœud source est le recto (question), le nœud cible est le verso (réponse), et le libellé de l'arête sert d'indice optionnel. Les chaînes (A → B → C), les relations un-vers-plusieurs et plusieurs-vers-un fonctionnent toutes ; les nœuds non connectés continuent d'être analysés avec les quatre formats ci-dessus. Détails dans **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

![Canvas Spatial Cards Demo](./canvas_spatial_cards_demo.gif)

## Modèles

Affichez les lignes d'un tableau via un design de carte que vous créez une seule fois. Écrivez-le en HTML/CSS
ou en Markdown, insérez des espaces réservés `{{Column}}` et liez-le à vos tableaux par une étiquette : un
modèle met en forme chaque ligne correspondante.

```decks-html-front
<ruby>{{Word}}<rt>{{Reading}}</rt></ruby>
```

Dans **Paramètres → Modèles**, choisissez un dossier, puis ajoutez la même étiquette au fichier de modèle et
au titre du tableau — c'est tout. Les modèles prennent en charge les faces recto/verso/notes en HTML ou
Markdown, s'affichent dans un bac à sable isolé, assaini et adapté au thème, et exposent des variables CSS
(`--padding`, `--align`, `--bg`, …) pour un contrôle total de la mise en page — des cartes de lecture
confortables aux designs personnalisés pleine largeur. Les tableaux sans modèle correspondant utilisent les
colonnes habituelles.

Voir **[docs/TEMPLATES.md](docs/TEMPLATES.md)** pour le guide complet et des exemples.

## Paquets d'examen

Lancez un paquet comme un examen noté : un tirage de questions auxquelles vous répondez en une seule
session, dans n'importe quel ordre, avec un récapitulatif des résultats — et éventuellement une limite de
temps et un score de réussite — à la fin. Les examens s'activent par profil et ajoutent un format de
rédaction : un en-tête suivi d'une liste de tâches devient une carte à choix multiple.

```markdown
## Quel élément est un gaz noble ?

- [ ] Oxygène
- [x] Argon
- [ ] Azote
```

`- [x]` marque une option correcte ; en cocher plusieurs rend la question à sélection multiple.

- Ajoutez à une note la sous-balise `exams` de votre balise de paquet (par défaut `#decks/exams`) pour
  utiliser le profil préinstallé **Exams**, ou activez **Questions d'examen** dans n'importe quel profil.
- Démarrez depuis le menu du paquet (**⋮ → Démarrer l'examen**) ou en cliquant sur un paquet d'examen ; une boîte
  de dialogue de configuration affiche le nombre de questions et vous laisse ajuster les paramètres de
  l'examen.
- Outre le choix multiple, les cartes en-tête + réponse et les lignes de tableau sont posées comme des
  questions à réponse saisie, et les cartes à trous affichent la phrase avec les surlignages comme des
  trous à remplir.
- Les réponses saisies sont notées exactement, avec tolérance aux petites fautes de frappe, ou
  auto-évaluées ; les valeurs par défaut de l'examen (nombre de questions, limite de temps, score de
  réussite, mélange, moment de la correction, libellés des options) vivent sur le profil.
- Les examens terminés sont stockés dans la base de données du plugin, fusionnent entre appareils et sont
  inclus dans les sauvegardes.

Un paquet « Examen de démonstration » présentant tous les formats de question est créé à la première installation (ou via
la commande **« Créer un paquet d'examen de démonstration »**).

Voir **[docs/EXAM_DECKS.md](docs/EXAM_DECKS.md)** pour toutes les règles de rédaction.

## Ce que vous obtenez

- Mode navigation et sessions de révision chronométrées avec limites journalières.
- Profils par balise (FSRS Standard / Intensif, cible de rétention, quotas journaliers).
- Paquets personnalisés construits à partir de règles de filtre — ex., toutes les cartes balisées `#lycée`.
- Mode examen : sessions d'examen notées avec questions à choix multiple, à réponse saisie et à trous.
- Statistiques : carte thermique (heatmap), rétention, prévisions des révisions futures, intervalles, répartition horaire, statistiques des boutons de réponse.
- Exportation Anki, sauvegardes automatiques, synchronisation avec fusion multi-appareils.
- Raccourcis clavier : **Espace** pour retourner, **1–4** pour évaluer.

## Planification personnalisée

FSRS est livré avec des paramètres par défaut judicieux qui fonctionnent très bien immédiatement. Une fois que vous avez accumulé environ 100 révisions, vous pouvez entraîner les 21 poids de l'algorithme sur votre propre historique de révisions pour obtenir des planifications adaptées à votre courbe d'oubli spécifique — le même type de chose qu'Anki de bureau fait, mais côté client, sans serveur et sans télémétrie.

**Paramètres → Ajustement de l'algorithme → Optimiser les paramètres.** L'entraînement s'exécute en quelques secondes pour les paquets typiques ; vous verrez une comparaison de perte logarithmique (log-loss) avant/après. Cliquez sur Appliquer pour utiliser les poids entraînés ou Ignorer pour conserver les valeurs par défaut.

## Migration depuis Spaced Repetition

Vous utilisez déjà le plugin **Spaced Repetition** ? Vous pouvez passer à Decks **sans perdre vos cartes ni votre historique de révision** — et continuer vos révisions exactement là où vous vous étiez arrêté.

Ouvrez l'outil de migration depuis la barre d'outils du panneau des paquets (l'icône en forme de cube) ou exécutez la commande **« Migrer depuis le plugin Spaced Repetition »**.

**Vos notes d'origine ne sont jamais modifiées.** La migration est additive : elle écrit de nouveaux fichiers dans un dossier cible que vous choisissez (en reproduisant votre structure) et laisse vos notes sources exactement telles qu'elles sont. Relancer l'outil de migration écrase simplement les fichiers qu'il a générés.

**Comment ça marche**

1. **Choisissez un dossier source** à analyser (ou laissez-le vide pour analyser tout le coffre), ainsi qu'un dossier cible pour la sortie. Decks trouve toutes les notes contenant d'anciennes cartes — sur une seule ligne (`Front :: Back`), inversées (`Front ::: Back`), multi-lignes (`?` / `??`), à trous (`==…==` / `{{…}}`) — et les révisions de notes entières (le tag `#review`).
2. **Chaque note est scindée en deux fichiers propres.** Un **paquet de cartes** (`<Note> (Cartes)`) contient les cartes extraites au format standard de Decks, et une **note lisible** conserve le texte — avec la syntaxe des cartes *décodée* en texte normal (`::` / `:::` deviennent « — », `?` / `??` réunissent question et réponse, et les trous `==…==` / `{{…}}` sont restaurés vers leur réponse). Vos séparateurs configurés sont respectés, donc cela fonctionne même si vous les avez personnalisés. Rien n'est supprimé — votre note de lecture reste complète.
3. **Les fichiers sont liés entre eux dans le frontmatter.** La note lisible reçoit une propriété `Cartes` pointant vers son paquet et une propriété `Note d'origine` renvoyant vers l'original ; le paquet reçoit lui aussi une propriété `Note d'origine`. Si une note utilise déjà l'un de ces noms de propriété, l'outil de migration l'écrase plutôt que de créer un doublon. Vos tags sont préservés — l'ancien tag de base (par ex. `#flashcards`) est traduit vers votre tag Decks configuré.
4. **Les cartes inversées deviennent deux cartes.** Une carte `Front ::: Back` est développée en une carte directe et une carte inversée dans le **même** fichier de paquet, de sorte que chaque sens est planifié indépendamment.
5. **La structure imbriquée est aplatie en contexte.** SR considère les titres ancêtres et les puces de liste imbriquées comme le contexte d'une carte. Decks capture tout ce chemin dans le recto de la carte — par ex. un `Function :: Powerhouse` profondément imbriqué devient `Cell Anatomy > Mitochondria > … > Function` — rendu au niveau de titre unique de votre profil (un H1 isolé correspondant au titre de la note est omis). Choisissez n'importe quel niveau via les profils préinstallés **Heading 1–6**.
6. **Un routage automatique intelligent choisit la meilleure disposition.** Les cartes courtes sur une seule ligne deviennent des lignes dans un **tableau** compact (plus de défilement interminable pour le vocabulaire) ; les cartes multi-lignes — avec blocs de code, listes ou formules mathématiques — deviennent des **titres** afin que leur mise en forme soit préservée. Vous pouvez remplacer ce choix par *tout en titres* ou *tout en tableaux* dans la boîte de dialogue.
7. **Les révisions de notes entières migrent aussi.** Les notes que vous révisiez dans leur ensemble (le tag `#review`) deviennent des cartes Decks en **mode titre** (nom de fichier = recto, note entière = verso) sous un profil `…/review` dédié. Leur planification est lue depuis le frontmatter `sr-*` de la note ou son marqueur en fin de fichier.
8. **Votre état de planification est traduit vers FSRS-6.** Decks lit les métadonnées héritées `<!--SR:-->` — SM-2 (`due, interval, ease`) ou déjà FSRS — et les associe à un état de stabilité/difficulté/échéance. Les cartes inversées conservent **deux historiques distincts** (lecture vs. rappel), exactement comme le plugin d'origine les stockait.
9. **Un journal de révision est écrit pour chaque carte migrée**, de sorte qu'au moment où les cartes apparaissent dans Decks elles sont déjà dues à la bonne date avec le bon intervalle — vous reprenez, vous ne recommencez pas.

Choisissez un profil dans la boîte de dialogue (ou utilisez celui par défaut) — son niveau de titre et ses paramètres de planification sont appliqués aux paquets migrés.

## Migration depuis Anki

Vous passez d'Anki ? Vous pouvez importer toute votre collection dans Decks **sans perdre vos cartes, vos médias ni votre historique de révision** — et continuer avec FSRS-6.

Dans Anki, exportez votre paquet (ou toute la collection) au format **`.apkg`** (**Fichier → Exporter**, format *Paquet de cartes Anki*, avec **Inclure les médias** et **Inclure les informations de planification** cochés). Ouvrez ensuite l'importateur depuis la barre d'outils du panneau des paquets ou lancez la commande **« Import from Anki »**, choisissez le fichier et un dossier de destination, puis importez. Les exports `.apkg` anciens comme récents (compressés) fonctionnent.

**Votre collection Anki n'est jamais modifiée.** L'import est additif : il écrit de nouveaux fichiers dans un dossier de destination que vous choisissez, imbriqué sous l'étiquette `#decks/anki`, et laisse le `.apkg` source tel quel. Réimporter le même fichier écrase les fichiers générés et rafraîchit leurs médias — vous pouvez donc le relancer à tout moment.

**Comment ça marche**

1. **Choisissez le `.apkg` et un dossier de destination.** Decks le décompresse en mémoire, lit la collection Anki intégrée (ancien format ou nouveau format compressé) et copie chaque fichier média référencé dans un dossier `media/` de votre coffre. La hiérarchie d'origine des paquets Anki (`Parent::Enfant`) est conservée sous forme de dossiers.
2. **Chaque type de note devient une carte Decks propre.** Les notes basiques alternent automatiquement entre un **tableau** compact et des **titres** ; les **clozes** deviennent des surlignages `==…==` — y compris les clozes à l'intérieur de MathJax `$…$` ; les notes **multi-champs / à modèle** reçoivent un modèle généré automatiquement ; et les cartes d'**occlusion d'image** d'Anki arrivent en occlusion native de Decks.
3. **Médias, maths et étiquettes sont conservés.** L'audio et les images sont intégrés et lus/rendus en révision ; les images gardent leur taille d'origine ; LaTeX/MathJax est préservé ; vos étiquettes Anki sont regroupées et triées en sections lisibles.
4. **Votre état de planification est traduit en FSRS-6.** La date d'échéance, l'intervalle et la facilité de chaque carte — plus son historique de révision Anki complet — sont mappés vers un état stabilité/difficulté/échéance et écrits comme journal de révision, de sorte que les cartes apparaissent **déjà dues à la bonne date avec le bon intervalle**. Vous reprenez, vous ne recommencez pas.
5. **Les gros paquets riches en médias restent fluides.** Un grand paquet est automatiquement découpé en fichiers plafonnés et rangés en sous-dossiers — selon le nombre de cartes et le nombre d'intégrations média — pour qu'un paquet avec des milliers de clips audio s'ouvre encore rapidement dans Obsidian. Les paquets plus petits restent un seul fichier.
6. **Vous le voyez se faire.** Une barre de progression suit chaque phase — lecture de la collection, écriture des paquets, copie des médias, synchronisation et import de l'historique de révision — pour qu'un import même volumineux ne paraisse jamais bloqué.

Choisissez un profil dans la boîte de dialogue (ou utilisez celui par défaut) — son niveau de titre et ses réglages de planification s'appliquent aux paquets importés, imbriqués sous l'étiquette `#decks/anki`.

## Notes de version & Support

- Les **Notes de version** pour chaque mise à jour se trouvent dans [`release-notes/`](./release-notes/).
- **Discutez sur Discord** — [rejoignez le serveur](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Soutenez le développement** — [Offrez-moi un café](https://www.buymeacoffee.com/dscherdil0).
- **Guide de traduction** - [Guide de traduction](./docs/TRANSLATING.md).

## Assistance IA (facultative)

Fonctions IA facultatives, **désactivées tant que vous n'ajoutez pas une clé de fournisseur dans Réglages → IA** :

- **Générer** — créez des cartes à partir d'une consigne (et de notes/images facultatives) et enregistrez-les dans un nouveau fichier ou un paquet existant en titre+paragraphe, tableau ou canevas.
- **Refactoriser** une carte ou une sélection entière, ou **scinder** une carte en plusieurs — vous validez chaque changement avant son application.

Utilisez votre propre clé OpenAI, Anthropic (Claude), Google (Gemini) ou un point d'accès compatible OpenAI/local. Les clés sont stockées localement dans `ai-keys.json` et ne sont jamais écrites dans `data.json` : elles ne quittent donc pas votre appareil via la synchronisation. Rien n'est envoyé à un fournisseur tant que vous ne lancez pas une action ; chaque requête ne contient qu'une consigne intégrée sur le fonctionnement de Decks, vos instructions et le contenu de cette action.

![Decks AI Generator](./decks_ai_generate.gif)

## Construit sur

Decks est construit sur **[`@decks/core`](https://github.com/dscherdi/decks-core)** — le moteur open source (MIT) qui implémente l'analyse, la planification FSRS, la synchronisation et l'orchestration IA. Le plugin en est l'enveloppe spécifique à Obsidian.

## Licence

Ce projet est sous licence **GNU Affero General Public License v3.0 ou ultérieure** (AGPL-3.0-or-later).

En bref : vous êtes libre d'utiliser, de modifier et de distribuer ce logiciel. Cependant, si vous le
modifiez et distribuez vos modifications — ou si vous le modifiez et le proposez aux utilisateurs via un
réseau — vous devez rendre votre code source modifié publiquement disponible sous la même licence AGPL-3.0.

Copyright (C) 2026 Xherdi Lika. Voir le fichier [LICENSE](./LICENSE) pour le texte complet.

---

> Cette traduction est une ébauche — corrections et suggestions sont les bienvenues dans le suivi des tickets (issues).
