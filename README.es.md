# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · **Español** · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Convierte tus notas de Obsidian en tarjetas de memoria. Sin sintaxis especial. Sin mazo aparte que construir.**

Etiqueta un archivo con `#decks`. Cada encabezado `##` se convierte en el anverso de una tarjeta; el texto debajo se convierte en el reverso. Las tablas, la oclusión de imágenes y los resaltados `==cloze==` funcionan de la misma manera. La planificación la gestiona FSRS-6 — el algoritmo moderno de repetición espaciada.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Notas de versión](./release-notes/) · [Invítame a un café](https://www.buymeacoffee.com/dscherdil0)

## Por qué Decks

- **Tus notas ya son el mazo.** Etiqueta un archivo: cada encabezado del nivel que elijas se convierte en un anverso y el texto debajo en un reverso. Si vienes de Anki, no hay nada que escribir dos veces.
- **Cuatro formatos, ninguna sintaxis que aprender.** Encabezados, tablas de dos columnas, oclusión de imágenes y `==cloze==` desde los resaltados que ya usas.
- **Planificación FSRS nativa.** Tres perfiles (Estándar / Intensivo / Entrenado), objetivos de retención por etiqueta, sin lastre de SM-2.
- **Ajuste del algoritmo.** El optimizador de un clic entrena los pesos de FSRS con tu propio historial de repasos — mejor planificación para tu curva de olvido, todo del lado del cliente.
- **Sincronización real entre dispositivos.** La base de datos se combina automáticamente a través de iCloud/Dropbox — repasa en el móvil y en el escritorio sin perder historial.
- **Diseñado para móviles.** Interfaz de repaso optimizada para tocar, consciente del safe-area, probada a diario en teléfonos.

## Inicio rápido en 60 segundos

1. Instala **Decks** desde los plugins de la comunidad y actívalo.
2. Abre cualquier nota. Añade `#decks` a su frontmatter o como etiqueta en línea.
3. Escribe un encabezado `##`, luego un párrafo debajo. Repite para tantas tarjetas como quieras:

   ```markdown
   ---
   tags: [decks/espanol]
   ---

   ## ¿Qué significa "Hola"?

   Saludo.

   ## ¿Cómo se dice "Gracias" en inglés?

   Thank you.
   ```

4. Haz clic en el **icono del cerebro** en la barra lateral para abrir el panel de Decks. Haz clic en tu archivo. Comienza a repasar.

El nombre de archivo se convierte en el nombre del mazo. Las tarjetas se sincronizan automáticamente al guardar la nota.

## Formatos de tarjeta

Decks admite cuatro formas de escribir tarjetas. Elige la que coincida con cómo ya escribes notas.

<details>
<summary><b>Encabezado + párrafo</b> — el formato por defecto. Cada encabezado del nivel configurado (H2 por defecto) es un anverso; el cuerpo debajo es el reverso.</summary>

```markdown
---
tags: [decks/espanol]
---

## ¿Qué significa "Hola" en inglés?

Hello.

## ¿Cómo se dice "Gracias" en inglés?

Thank you.
```

El nombre de archivo se convierte en el nombre del mazo. El nivel del encabezado se configura por perfil (H2 por defecto). Los encabezados por encima del nivel configurado no se convierten en tarjetas: se conservan como una ruta de migas (p. ej. `Capítulo 1 > Sección 2`) adjunta a cada tarjeta para dar contexto.

Añade **notas** opcionales a una tarjeta de encabezado+párrafo con un comentario de Obsidian (`%%una pista%%`) en cualquier parte del cuerpo, o tras un divisor `---` al final. Las notas se muestran a demanda (tecla **N**) durante el repaso.

</details>

<details>
<summary><b>Tablas</b> — tablas markdown de dos columnas, con una columna opcional de notas.</summary>

```markdown
## Conceptos

| Pregunta                 | Respuesta                                              |
| ------------------------ | ------------------------------------------------------ |
| ¿Qué es la fotosíntesis? | El proceso por el que las plantas convierten luz solar |
| Define la gravedad       | La fuerza que atrae los objetos entre sí               |
```

- Primera columna = anverso, segunda columna = reverso. Se ignora la fila de cabecera.
- Las tablas deben colocarse directamente bajo un encabezado (sin otros párrafos en medio).
- Añade una tercera columna "Notas" para pistas/mnemotécnicas que se muestran con un interruptor (pulsa **N**) durante el repaso.

</details>

<details>
<summary><b>Huecos (cloze)</b> — resalta texto con <code>==texto==</code> para ocultarlo.</summary>

```markdown
## El sistema solar

El ==Sol== es la estrella en el centro de nuestro sistema solar. El planeta más cercano al Sol es ==Mercurio==, y el planeta más grande es ==Júpiter==.
```

Cada resaltado se convierte en una tarjeta. Durante el repaso, el hueco activo aparece como `[...]`; toca para revelarlo. Los huecos también funcionan dentro de celdas de tabla. Dos modos de contexto por perfil (ocultar o mostrar otros huecos). Activado por defecto.

</details>

<details>
<summary><b>Oclusión de imágenes</b> — una imagen más una lista numerada. Los números en la imagen se mapean con la lista.</summary>

```markdown
## Huesos del brazo

![[huesos_brazo.png]]

1. ==Húmero==
2. ==Radio==
3. ==Cúbito==
```

Cada elemento de la lista es una tarjeta. La imagen (con sus etiquetas numeradas) se muestra en el anverso; el elemento correspondiente se oculta en el reverso. Se basa en los huecos, por lo que cloze debe estar activado en el perfil.

</details>

<details>
<summary><b>Más: formato título, tarjetas inversas, etiquetas por tarjeta</b></summary>

**Formato título** — el nombre de archivo se convierte en el anverso, todo el archivo en el reverso. Establece "Título" como nivel del encabezado en tu perfil.

**Tarjetas inversas** — añade `reverse: true` al frontmatter de un archivo para generar automáticamente una copia inversa de cada tarjeta. El progreso se rastrea por separado en cada dirección.

**Etiquetas por tarjeta** — añade `#etiqueta` directamente en los encabezados (p. ej. `## ¿Qué es la fotosíntesis? #plantas #secundaria`). Las etiquetas se retiran del anverso mostrado, aparecen como chips durante el repaso y se heredan por las filas de tabla y las tarjetas inversas. Crea "mazos de filtro" que reúnen cada tarjeta con una etiqueta dada en todo tu vault.

</details>

### Mazos de canvas

Crea tarjetas en un Canvas de Obsidian (`.canvas`) en lugar de un archivo Markdown. Cada canvas en la carpeta configurada se convierte en un mazo; cada nodo de texto se analiza con los mismos cuatro formatos de tarjeta de arriba. Configúralo en **Ajustes → Mazos de canvas**: carpeta y etiqueta (por defecto `#decks/canvas`). «Ir a la fuente» desde el repaso abre el canvas y enfoca el nodo de origen. En la primera instalación (o actualización) se crea automáticamente un `Decks — Comenzar con canvas.canvas` dentro de la carpeta `Canvas decks/`.

**Tarjetas espaciales (Spatial cards)**: conecta nodos de texto con aristas y cada arista se convierte en una tarjeta: el nodo de origen es el anverso (pregunta), el nodo de destino es el reverso (respuesta) y la etiqueta de la arista es una pista opcional. Funcionan cadenas (A → B → C), uno-a-muchos y muchos-a-uno; los nodos no conectados se siguen analizando con los cuatro formatos anteriores. Detalles en **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**.

![Canvas Spatial Cards Demo](./canvas_spatial_cards_demo.gif)

## Plantillas

Renderiza las filas de una tabla con un diseño de tarjeta que creas una sola vez. Escríbelo en HTML/CSS o
Markdown, coloca marcadores `{{Column}}` y vincúlalo a tus tablas mediante una etiqueta: una plantilla da
estilo a cada fila que coincida.

```decks-html-front
<ruby>{{Word}}<rt>{{Reading}}</rt></ruby>
```

Apunta **Ajustes → Plantillas** a una carpeta y etiqueta el archivo de plantilla y el encabezado de la tabla
con la misma etiqueta: listo. Las plantillas admiten caras de anverso/reverso/notas en HTML o Markdown, se
renderizan en un entorno aislado, saneado y consciente del tema, y exponen variables CSS (`--padding`,
`--align`, `--bg`, …) para un control total del diseño, desde cómodas tarjetas de lectura hasta diseños
personalizados a sangre. Las tablas sin plantilla coincidente siguen usando las columnas normales.

Consulta **[docs/TEMPLATES.md](docs/TEMPLATES.md)** para la guía completa y ejemplos.

## Lo que obtienes

- Modo exploración y sesiones de repaso cronometradas con límites diarios.
- Perfiles por etiqueta (FSRS estándar / intensivo, objetivo de retención, cuotas diarias).
- Mazos personalizados creados a partir de reglas de filtro — p. ej. cada tarjeta etiquetada con `#secundaria`.
- Estadísticas: mapa de calor, retención, pronóstico de vencimientos futuros, intervalos, desglose por hora, estadísticas de botones de respuesta.
- Exportación a Anki, copias de seguridad automáticas, sincronización con fusión multi-dispositivo.
- Atajos de teclado: **Espacio** para voltear, **1–4** para calificar.

## Sincronización multi-dispositivo

Decks se sincroniza junto con tu vault — iCloud Drive, Obsidian Sync, Dropbox, Syncthing — cualquier cosa que comparta la carpeta del vault funciona.

El plugin usa dos archivos:

- **`<carpeta del plugin>/flashcards.db`** — la base de datos SQLite que contiene el estado FSRS de cada tarjeta y el historial completo de repasos. Es el snapshot de almacenamiento en frío, que se persiste a disco cada ~30 minutos cuando hay nueva actividad (y al pasar la app a segundo plano / descargarse).
- **`<deviceId>.deckssynclog`** — un pequeño archivo JSONL solo-anexar por dispositivo, en la raíz de tu vault. Cada cambio de estado — calificar una tarjeta, editar un perfil, crear un mazo personalizado, iniciar/terminar una sesión de repaso — se registra aquí como una única línea corta. Otros dispositivos leen estos archivos al enfocar la app y reproducen las entradas en su propia base de datos.

La extensión personalizada `.deckssynclog` mantiene el archivo fuera del explorador de archivos de Obsidian; lo verás en Finder/Archivos pero nunca aparece como una nota. iCloud y otros proveedores de sincronización de archivos transfieren estos pequeños archivos de texto **drásticamente más rápido** que la base de datos binaria — habitualmente segundos en lugar de minutos — por eso el retardo entre dispositivos del tipo "acabo de calificar esto en mi Mac y ahora lo veo en el iPhone" suele rondar los 15–30 segundos en lugar de 1–2 minutos.

El registro se trunca automáticamente a los últimos 30 días al cargar el plugin. El estado de larga duración entre dispositivos (meses o años de historial de repasos) se conserva en la base de datos binaria, que aún se sincroniza a través de tu proveedor de archivos según su propio calendario más lento.

Si tu proveedor de sincronización crea archivos de copia en conflicto (p. ej. iCloud `<deviceId> (Mac's conflicted copy 2026-05-13).deckssynclog`), el plugin los detecta, aplica las entradas únicas y renombra el original a un lado como `*.consumed-<timestamp>` para que no se vuelva a procesar.

## Planificación personalizada

FSRS viene con valores predeterminados razonables que funcionan bien desde el principio. Una vez que hayas acumulado ~100 repasos, puedes entrenar los 21 pesos del algoritmo con tu propio historial de repasos y obtener planificaciones de tarjetas adaptadas a tu curva de olvido específica — algo parecido a lo que hace Anki desktop, pero del lado del cliente, sin servidor, sin telemetría.

**Ajustes → Ajuste del algoritmo → Optimizar parámetros.** El entrenamiento corre en segundos para mazos típicos; verás una comparativa de log-loss antes/después, haz clic en Aplicar para usar los pesos entrenados o Descartar para mantener los predeterminados. Vuelve a entrenar cuando quieras para refinar los pesos a medida que acumulas más repasos.

Los pesos entrenados son globales pero se aplican por perfil — selecciona **Entrenado** en el desplegable de perfil FSRS de cualquier perfil para activarlo. Los perfiles intensivos siguen usando sus valores predeterminados sub-diarios; los datos existentes de las tarjetas se conservan a través del entrenamiento.

<details>
<summary>Cómo funciona por dentro</summary>

El optimizador coincide con la metodología de referencia de open-spaced-repetition: optimizador Adam sobre la pérdida binary cross-entropy, tasa de aprendizaje con cosine-annealing, recorte de parámetros respecto a los límites publicados de FSRS-6. El número de pasos escala con tu historial de repasos (más repasos → más iteraciones).

La implementación ha sido validada contra la especificación publicada de FSRS-6 (1396/1396 casos de paso hacia adelante coinciden bit a bit) y comparada con 443M repasos anonimizados de Anki — la calibración de los valores predeterminados coincide con el recuerdo empírico dentro de 0,8 puntos porcentuales. Consulta [docs/FSRS_OPTIMIZER.md](./docs/FSRS_OPTIMIZER.md) para la descripción completa: comparación con el benchmark de referencia, qué esperar con distintos tamaños de mazo y limitaciones conocidas.

</details>

## Ajustes

Abre **Ajustes → Decks** para límites diarios, objetivos de retención, rutas de búsqueda, duración de la sesión y opciones de copia de seguridad. Anulaciones por etiqueta a través del icono de engranaje en cualquier mazo.

<details>
<summary>Todos los ajustes</summary>

**Ajustes de perfil** (Gestionar perfiles en el panel de mazos):

- Tarjetas nuevas por día, tarjetas de repaso por día (por mazo)
- Objetivo de retención (por defecto 90%)
- Perfil FSRS: Estándar, Intensivo o Entrenado (Entrenado disponible tras optimizar parámetros)
- Nivel del encabezado para el análisis (o "Título" para usar el nombre de archivo)
- Orden de repaso: más antigua primero o aleatorio
- Huecos: activados por defecto
- Contexto de huecos: ocultos o abiertos

**Ajustes de repaso:** duración de la sesión (1–60 min), hora de rollover del día siguiente (por defecto 4 AM), interruptor de atajos de teclado.

**Ajustes de análisis:** escanear todo el vault o limitarse a una carpeta.

**Otros:** intervalo de actualización en segundo plano, número de copias automáticas, registro de depuración.

</details>

## Migrar desde Spaced Repetition

¿Ya usas el plugin **Spaced Repetition**? Puedes cambiar a Decks **sin perder tus tarjetas ni tu historial de repaso**, y continuar tus repasos exactamente donde los dejaste.

Abre el migrador desde la barra de herramientas del panel de mazos (el icono del cubo) o ejecuta el comando **"Migrar desde el plugin Spaced Repetition"**.

**Tus notas originales nunca se tocan.** La migración es aditiva: escribe archivos nuevos en una carpeta de destino que tú eliges (replicando tu estructura) y deja tus notas de origen exactamente como están. Volver a ejecutar el migrador simplemente sobrescribe los archivos que generó.

**Cómo funciona**

1. **Elige una carpeta de origen** para escanear (o déjala vacía para escanear todo el vault) y una carpeta de destino para la salida. Decks encuentra cada nota con tarjetas heredadas: de una sola línea (`Front :: Back`), invertidas (`Front ::: Back`), de varias líneas (`?` / `??`), clozes (`==…==` / `{{…}}`) y repasos de nota completa (la etiqueta `#review`).
2. **Cada nota se divide en dos archivos limpios.** Un **mazo de tarjetas** (`<Nota> (Tarjetas)`) contiene las tarjetas extraídas en el formato estándar de Decks, y una **nota legible** conserva el texto, con la sintaxis de tarjetas *convertida* a texto normal (`::` / `:::` se convierten en " — ", `?` / `??` unen pregunta y respuesta, y los clozes `==…==` / `{{…}}` se restauran a su respuesta). Se respetan los separadores que hayas configurado, así que esto funciona incluso si los personalizaste. No se elimina nada: tu nota de lectura queda completa.
3. **Los archivos se enlazan entre sí en el frontmatter.** La nota legible recibe una propiedad `Tarjetas` que apunta a su mazo y una propiedad `Nota de origen` que apunta de vuelta al original; el mazo también recibe una propiedad `Nota de origen`. Si una nota ya usa uno de esos nombres de propiedad, el migrador lo sobrescribe en lugar de crear un duplicado. Tus etiquetas se conservan: la etiqueta base heredada (p. ej. `#flashcards`) se traduce a tu etiqueta de Decks configurada.
4. **Las tarjetas invertidas se convierten en dos tarjetas.** Una tarjeta `Front ::: Back` se expande en una tarjeta directa y una tarjeta invertida en el **mismo** archivo de mazo, de modo que cada dirección se programa de forma independiente.
5. **La estructura anidada se aplana en contexto.** SR trata los encabezados ancestros y los puntos de lista anidados como el contexto de una tarjeta. Decks captura toda esa ruta en el anverso de la tarjeta; p. ej. un `Function :: Powerhouse` profundamente anidado se convierte en `Cell Anatomy > Mitochondria > … > Function`, renderizado en el único nivel de encabezado de tu perfil (se omite un H1 solitario de título de nota). Elige cualquier nivel mediante los perfiles preinstalados **Heading 1–6**.
6. **El enrutamiento automático inteligente elige el mejor diseño.** Las tarjetas cortas de una sola línea se convierten en filas de una **tabla** compacta (sin desplazamiento interminable para el vocabulario); las tarjetas de varias líneas (con bloques de código, listas o fórmulas) se convierten en **encabezados** para que su formato sobreviva. Puedes anular esto a *todos encabezados* o *todas tablas* en el diálogo.
7. **Los repasos de nota completa también se migran.** Las notas que repasabas como un todo (la etiqueta `#review`) se convierten en tarjetas de **modo título** de Decks (nombre de archivo = anverso, la nota completa = reverso) bajo un perfil dedicado `…/review`. Su programación se lee del frontmatter `sr-*` de la nota o de su marcador al final del archivo.
8. **Tu estado de programación se traduce a FSRS-6.** Decks lee los metadatos heredados `<!--SR:-->` —SM-2 (`due, interval, ease`) o ya FSRS— y los asigna a un estado de estabilidad/dificultad/vencimiento. Las tarjetas invertidas mantienen **dos historiales separados** (lectura vs. recuerdo), exactamente como los almacenaba el plugin original.
9. **Se escribe un registro de repaso para cada tarjeta migrada**, de modo que en el momento en que las tarjetas aparecen en Decks ya están vencidas en la fecha correcta con el intervalo correcto: reanudas, no reinicias.

Elige un perfil en el diálogo (o usa el predeterminado): su nivel de encabezado y su configuración de programación se aplican a los mazos migrados.

## Notas de versión y soporte

- **Notas de versión** de cada versión en [`release-notes/`](./release-notes/).
- **Discusión en Discord** — [únete al servidor](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Apoya el desarrollo** — [Invítame a un café](https://www.buymeacoffee.com/dscherdil0).
- **Guía de traducción** - [Guía de traducción](./docs/TRANSLATING.md).

## Asistencia con IA (opcional)

Funciones de IA opcionales, **desactivadas hasta que añadas una clave de proveedor en Ajustes → IA**:

- **Generar** — crea tarjetas a partir de una indicación (y notas/imágenes opcionales) y guárdalas en un archivo nuevo o un mazo existente como encabezado+párrafo, tabla o lienzo.
- **Refactorizar** una tarjeta o una selección entera, o **dividir** una tarjeta en varias — revisas cada cambio antes de aplicarlo.

Usa tu propia clave de OpenAI, Anthropic (Claude), Google (Gemini) o un endpoint compatible con OpenAI/local. Las claves se guardan localmente en `ai-keys.json` y nunca se escriben en `data.json`, así que no salen de tu dispositivo por la sincronización. No se envía nada a un proveedor salvo que inicies una acción; cada petición contiene solo una indicación interna sobre cómo funciona Decks, tus instrucciones y el contenido de esa acción.

![Decks AI Generator](./decks_ai_generate.gif)

## Basado en

Decks está construido sobre **[`@decks/core`](https://github.com/dscherdi/decks-core)** — el motor de código abierto (MIT) que implementa el análisis, la planificación FSRS, la sincronización y la orquestación de IA. El complemento es la capa específica de Obsidian a su alrededor.

## Licencia

Este proyecto está licenciado bajo la **GNU Affero General Public License v3.0 o posterior**
(AGPL-3.0-or-later).

En resumen: eres libre de usar, modificar y distribuir este software. Sin embargo, si lo modificas y
distribuyes tus cambios — o lo modificas y lo ofreces a los usuarios a través de una red — debes poner tu
código fuente modificado a disposición del público bajo la misma licencia AGPL-3.0.

Copyright (C) 2026 Xherdi Lika. Consulta el archivo [LICENSE](./LICENSE) para ver el texto completo.

---

> Esta traducción es un borrador — las correcciones y sugerencias son bienvenidas en el issue tracker.
