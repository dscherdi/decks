# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · **Español** · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**Convierte tus notas de Obsidian en tarjetas de memoria. Sin sintaxis especial. Sin mazo aparte que construir.**

Etiqueta un archivo con `#decks`. Cada encabezado que hayas escrito se convierte en el anverso de una tarjeta; cada párrafo debajo se convierte en el reverso. Las tablas, la oclusión de imágenes y los resaltados `==cloze==` funcionan de la misma manera. La planificación la gestiona FSRS — el algoritmo moderno de repetición espaciada.

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [Notas de versión](./release-notes/) · [Invítame a un café](https://www.buymeacoffee.com/dscherdil0)

## Por qué Decks

- **Tus notas ya son el mazo.** Etiqueta un archivo: cada encabezado se convierte en un anverso, cada párrafo en un reverso. Si vienes de Anki, no hay nada que escribir dos veces.
- **Cuatro formatos, ninguna sintaxis que aprender.** Encabezados, tablas de dos columnas, oclusión de imágenes y `==cloze==` desde los resaltados que ya usas.
- **Planificación FSRS nativa.** Tres perfiles (Estándar / Intensivo / Entrenado), objetivos de retención por etiqueta, sin lastre de SM-2.
- **Ajuste del algoritmo.** El optimizador de un clic entrena los pesos de FSRS con tu propio historial de repasos — mejor planificación para tu curva de olvido, todo del lado del cliente.
- **Sincronización real entre dispositivos.** La base de datos se combina automáticamente a través de iCloud/Dropbox — repasa en el móvil y en el escritorio sin perder historial.
- **Diseñado para móviles.** Interfaz de repaso optimizada para tocar, consciente del safe-area, probada a diario en teléfonos.

## Inicio rápido en 60 segundos

1. Instala **Decks** desde los plugins de la comunidad y actívalo.
2. Abre cualquier nota. Añade `#decks` a su frontmatter o como etiqueta en línea.
3. Escribe un encabezado, luego un párrafo debajo. Repite para tantas tarjetas como quieras:

   ```markdown
   ---
   tags: [decks/espanol]
   ---

   # ¿Qué significa "Hola"?

   Saludo.

   # ¿Cómo se dice "Gracias" en inglés?

   Thank you.
   ```

4. Haz clic en el **icono del cerebro** en la barra lateral para abrir el panel de Decks. Haz clic en tu archivo. Comienza a repasar.

El nombre de archivo se convierte en el nombre del mazo. Las tarjetas se sincronizan automáticamente al guardar la nota.

## Formatos de tarjeta

Decks admite cuatro formas de escribir tarjetas. Elige la que coincida con cómo ya escribes notas.

<details>
<summary><b>Encabezado + párrafo</b> — el formato por defecto. Cada encabezado es un anverso, el cuerpo debajo es el reverso.</summary>

```markdown
---
tags: [decks/espanol]
---

# ¿Qué significa "Hola" en inglés?

Hello.

# ¿Cómo se dice "Gracias" en inglés?

Thank you.
```

El nombre de archivo se convierte en el nombre del mazo. El nivel del encabezado se configura por perfil.

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

## Notas de versión y soporte

- **Notas de versión** de cada versión en [`release-notes/`](./release-notes/).
- **Discusión en Discord** — [únete al servidor](https://discord.com/channels/686053708261228577/1497268419861418035).
- **Apoya el desarrollo** — [Invítame a un café](https://www.buymeacoffee.com/dscherdil0).

## Licencia

Consulta [LICENSE](./LICENSE).

---

> Esta traducción es un borrador — las contribuciones de hablantes nativos son bienvenidas.
