import { strToU8, zipSync } from "fflate";
import { createRealDatabase } from "../setup-real-sql";

/**
 * Builds a tiny, self-contained Anki `.apkg` in memory for the import
 * integration tests. The structures (model JSON shape, cloze/occlusion syntax,
 * the real Original-Mask SVG geometry) are faithful to genuine Anki exports —
 * extracted once from sample decks — but trimmed to a handful of representative
 * notes so the tests assert exact, stable values instead of magic counts.
 *
 * Covers every importer path: a 2-field Basic card (with audio + real review
 * history), two multi-field template models (one carrying CSS), a Text/Extra
 * cloze, and an Image-Occlusion note backed by a real mask SVG.
 */

const FIELD_SEP = String.fromCharCode(0x1f);

// Real Original-Mask SVG (Image Occlusion Enhanced) — genuine rect geometry,
// rect ids relabelled to this fixture's image so the note's mask id resolves.
const OCCLUSION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="210">
 <g><title>Masks</title>
  <rect stroke="#2D2D2D" id="sblock-oa-1" height="13.09524" width="60.71429" y="42.38096" x="11.90473" fill="#FFEBA2"/>
  <rect id="sblock-oa-2" height="15.47619" width="58.33334" y="63.80953" x="9.52378" stroke="#2D2D2D" fill="#FFEBA2"/>
  <rect id="sblock-oa-3" height="16.66667" width="72.61905" y="85.23811" x="11.90473" stroke="#2D2D2D" fill="#FFEBA2"/>
  <rect id="sblock-oa-4" height="14.28571" width="69.04762" y="110.23811" x="11.90473" stroke="#2D2D2D" fill="#FFEBA2"/>
  <rect id="sblock-oa-5" height="14.28571" width="66.66667" y="135.23811" x="8.33331" stroke="#2D2D2D" fill="#FFEBA2"/>
  <rect id="sblock-oa-6" height="16.66667" width="73.80953" y="179.28573" x="9.52378" stroke="#2D2D2D" fill="#FFEBA2"/>
 </g>
</svg>`;

const PERIODIC_CSS = `.card { font-family: arial; text-align: center; color: black; background: white; }
.periodic-grid { display: grid; grid-template-columns: repeat(18, 1fr); gap: 2px; }
.cell { border: 1px solid #333; padding: 4px; font-weight: bold; }`;

interface FieldDef {
  name: string;
  ord: number;
}
interface TmplDef {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
}
interface ModelDef {
  id: string;
  name: string;
  type: number;
  flds: FieldDef[];
  tmpls: TmplDef[];
  css: string;
}

function fields(...names: string[]): FieldDef[] {
  return names.map((name, ord) => ({ name, ord }));
}

const MODELS: Record<string, ModelDef> = {
  "1000": {
    id: "1000",
    name: "Basic",
    type: 0,
    flds: fields("Front", "Back"),
    css: ".card { font-family: arial; }",
    tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}\n<hr id=answer>\n{{Back}}" }],
  },
  "2000": {
    id: "2000",
    name: "LoF-German-Standard",
    type: 0,
    flds: fields("German", "English", "Image", "Audio"),
    css: ".card { font-size: 20px; }",
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: "{{German}}",
        afmt: "{{FrontSide}}\n<hr id=answer>\n{{English}}<br>{{Image}}{{Audio}}",
      },
    ],
  },
  "3000": {
    id: "3000",
    name: "PeriodicTable",
    type: 0,
    flds: fields("Picture", "Name", "Number", "Symbol"),
    css: PERIODIC_CSS,
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: '<div class="periodic-grid">{{Picture}}<div class="cell">{{Symbol}}</div></div>',
        afmt: "{{FrontSide}}\n<hr id=answer>\n{{Name}} ({{Number}})",
      },
    ],
  },
  "4000": {
    id: "4000",
    name: "Cloze",
    type: 1,
    flds: fields("Text", "Extra"),
    css: ".cloze { font-weight: bold; color: blue; }",
    tmpls: [{ name: "Cloze", ord: 0, qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>\n{{Extra}}" }],
  },
  "5000": {
    id: "5000",
    name: "Image Occlusion Enhanced",
    type: 0,
    flds: fields("ID (hidden)", "Header", "Image", "Original Mask"),
    css: "#io-header { font-weight: bold; }",
    tmpls: [
      {
        name: "IO Card",
        ord: 0,
        qfmt: '{{#Image}}<div id="io-header">{{Header}}</div>{{Image}}{{/Image}}',
        afmt: "{{Image}}<hr id=answer>{{Original Mask}}",
      },
    ],
  },
};

const DECKS: Record<string, { id: number; name: string }> = {
  "10": { id: 10, name: "Languages on Fire – German::04. Das Wetter ist heute schön" },
  "11": { id: 11, name: "Vocabulary::Basics" },
  "12": { id: 12, name: "PCM::Chemistry::XI::Periodic table" },
  "13": { id: 13, name: "PCM::Math" },
  "14": { id: 14, name: "PCM::Chemistry::XI::S Block Elements" },
};

interface NoteDef {
  id: number;
  mid: number;
  flds: string[];
}
const NOTES: NoteDef[] = [
  { id: 101, mid: 1000, flds: ["Hallo", "Hello [sound:hallo.mp3]"] },
  {
    id: 102,
    mid: 2000,
    flds: [
      "Das Wetter ist heute schön.",
      "The weather is nice today.",
      '<img src="firetongues.jpg">',
      "[sound:firetongues.mp3]",
    ],
  },
  { id: 103, mid: 3000, flds: ['<IMG SRC="hydrogen.gif">', "Hydrogen", "1", "H"] },
  { id: 104, mid: 4000, flds: ["Du trinkst {{c1::jeden Tag}} Bier.", '<img src="bier.jpg"> informal'] },
  {
    id: 105,
    mid: 5000,
    flds: ["sblock-oa-1", "S Block Group 1", '<img src="sblock.jpg">', '<img src="sblock-oa-O.svg">'],
  },
];

interface CardDef {
  id: number;
  nid: number;
  did: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  data: string;
}
const NEW = { type: 0, queue: 0, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, data: "{}" };
const CARDS: CardDef[] = [
  // The Basic card carries native FSRS state + a review log (the only reviewed card).
  { id: 201, nid: 101, did: 11, ord: 0, type: 2, queue: 2, due: 100, ivl: 15, factor: 2500, reps: 4, lapses: 1, data: '{"s":12.3,"d":5.4}' },
  { id: 202, nid: 102, did: 10, ord: 0, ...NEW },
  { id: 203, nid: 103, did: 12, ord: 0, ...NEW },
  { id: 204, nid: 104, did: 13, ord: 0, ...NEW },
  { id: 205, nid: 105, did: 14, ord: 0, ...NEW },
];

interface RevlogDef {
  id: number;
  cid: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
}
const REVLOG: RevlogDef[] = [{ id: 1700000000000, cid: 201, ease: 3, ivl: 15, lastIvl: 6, factor: 2500 }];

// Numbered media blobs. Only the occlusion SVG needs real content (the mask
// parser reads it); the rest are placeholders — the integration test reads
// referenced names, not bytes.
const MEDIA_NAMES: Record<string, string> = {
  "0": "hallo.mp3",
  "1": "firetongues.jpg",
  "2": "firetongues.mp3",
  "3": "hydrogen.gif",
  "4": "bier.jpg",
  "5": "sblock.jpg",
  "6": "sblock-oa-O.svg",
};
const COLLECTION_CREATED_SECONDS = 1700000000;

/** Known fixture facts the integration test asserts against. */
export const SAMPLE = {
  cardCount: CARDS.length,
  noteCount: NOTES.length,
  withHistory: 1,
  germanDeckMatch: /German/i,
  germanFront: "Das Wetter ist heute schön.",
  germanBack: "The weather is nice today.",
  clozeSentence: "Du trinkst ==jeden Tag== Bier.",
  occlusionImage: "sblock.jpg",
  reviewedCardId: 201,
  reviewCount: REVLOG.length,
  collectionCreatedMs: COLLECTION_CREATED_SECONDS * 1000,
} as const;

// Note/card/revlog tables + rows are identical across schemas; only the model/deck
// storage differs (col JSON vs normalized tables).
type RawDb = ReturnType<typeof createRealDatabase>;
function createNoteCardRevlogTables(db: RawDb): void {
  db.run("CREATE TABLE notes (id integer primary key, mid integer, flds text);");
  db.run(
    "CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, " +
      "type integer, queue integer, due integer, ivl integer, factor integer, reps integer, " +
      "lapses integer, data text);"
  );
  db.run(
    "CREATE TABLE revlog (id integer primary key, cid integer, ease integer, ivl integer, " +
      "lastIvl integer, factor integer);"
  );
}
function insertNoteCardRevlogRows(db: RawDb): void {
  for (const n of NOTES) {
    db.run("INSERT INTO notes (id, mid, flds) VALUES (?, ?, ?);", [n.id, n.mid, n.flds.join(FIELD_SEP)]);
  }
  for (const c of CARDS) {
    db.run(
      "INSERT INTO cards (id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, data) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [c.id, c.nid, c.did, c.ord, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.data]
    );
  }
  for (const r of REVLOG) {
    db.run("INSERT INTO revlog (id, cid, ease, ivl, lastIvl, factor) VALUES (?, ?, ?, ?, ?, ?);", [
      r.id,
      r.cid,
      r.ease,
      r.ivl,
      r.lastIvl,
      r.factor,
    ]);
  }
}

// Legacy schema (≤11): models/decks live in the `col` JSON blobs.
function buildCollectionBytes(): Uint8Array {
  const db = createRealDatabase();
  try {
    db.run("CREATE TABLE col (id integer primary key, crt integer, models text, decks text);");
    createNoteCardRevlogTables(db);
    db.run("INSERT INTO col (id, crt, models, decks) VALUES (1, ?, ?, ?);", [
      COLLECTION_CREATED_SECONDS,
      JSON.stringify(MODELS),
      JSON.stringify(DECKS),
    ]);
    insertNoteCardRevlogRows(db);
    return db.export();
  } finally {
    db.close();
  }
}

// Modern schema (18): `col.models`/`col.decks` are empty; note types live in
// `notetypes`/`fields`/`templates` (protobuf configs) and decks in `decks`
// (hierarchy joined by \x1f). Mirrors `collection.anki21b`.
function buildCollectionBytesV18(): Uint8Array {
  const db = createRealDatabase();
  try {
    db.run("CREATE TABLE col (id integer primary key, crt integer, ver integer, models text, decks text, conf text);");
    db.run("CREATE TABLE notetypes (id integer primary key, name text, config blob);");
    db.run("CREATE TABLE fields (ntid integer, ord integer, name text, config blob);");
    db.run("CREATE TABLE templates (ntid integer, ord integer, name text, config blob);");
    db.run("CREATE TABLE decks (id integer primary key, name text);");
    createNoteCardRevlogTables(db);

    db.run("INSERT INTO col (id, crt, ver, models, decks, conf) VALUES (1, ?, 18, '', '', '');", [
      COLLECTION_CREATED_SECONDS,
    ]);
    for (const m of Object.values(MODELS)) {
      db.run("INSERT INTO notetypes (id, name, config) VALUES (?, ?, ?);", [
        Number(m.id),
        m.name,
        notetypeConfig(m.type, m.css),
      ]);
      for (const f of m.flds) {
        db.run("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?);", [
          Number(m.id),
          f.ord,
          f.name,
          new Uint8Array(),
        ]);
      }
      for (const t of m.tmpls) {
        db.run("INSERT INTO templates (ntid, ord, name, config) VALUES (?, ?, ?, ?);", [
          Number(m.id),
          t.ord,
          t.name,
          tmplConfig(t.qfmt, t.afmt),
        ]);
      }
    }
    for (const d of Object.values(DECKS)) {
      // Store hierarchy with \x1f (schema 18) so the parser's \x1f → :: conversion is exercised.
      db.run("INSERT INTO decks (id, name) VALUES (?, ?);", [d.id, d.name.replace(/::/g, "\x1f")]);
    }
    insertNoteCardRevlogRows(db);
    return db.export();
  } finally {
    db.close();
  }
}

function mediaBlobs(): Record<string, Uint8Array> {
  const blobs: Record<string, Uint8Array> = {};
  for (const [key, name] of Object.entries(MEDIA_NAMES)) {
    blobs[key] = name.endsWith(".svg") ? strToU8(OCCLUSION_SVG) : new Uint8Array([0]);
  }
  return blobs;
}

/** Legacy `.apkg`: uncompressed `collection.anki21` + a JSON media map. */
export function buildSampleApkg(): Uint8Array {
  return zipSync({
    "collection.anki21": buildCollectionBytes(),
    media: strToU8(JSON.stringify(MEDIA_NAMES)),
    ...mediaBlobs(),
  });
}

/**
 * Modern `.apkg`: zstd-compressed `collection.anki21b` + a protobuf media
 * manifest. The collection is wrapped in raw (uncompressed) zstd blocks — a
 * valid frame `fzstd` decodes — so no compressor is needed at test time.
 */
export function buildSampleApkgNewFormat(): Uint8Array {
  const names = Object.keys(MEDIA_NAMES)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => MEDIA_NAMES[k]);
  return zipSync({
    // Mirror a real modern export: the authoritative data is zstd anki21b, with a
    // legacy anki2 "please update" stub for old clients (must be ignored).
    "collection.anki21b": zstdRawFrame(buildCollectionBytes()),
    "collection.anki2": strToU8("legacy stub — please update to the latest Anki version"),
    media: protobufMediaManifest(names),
    ...mediaBlobs(),
  });
}

/**
 * Fully modern `.apkg`: schema-18 collection (`col.models`/`decks` empty; data in
 * `notetypes`/`fields`/`templates`/`decks` with protobuf configs) zstd-compressed
 * as `collection.anki21b`, plus a protobuf media manifest and a legacy stub.
 */
export function buildSampleApkgV18(): Uint8Array {
  const names = Object.keys(MEDIA_NAMES)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => MEDIA_NAMES[k]);
  return zipSync({
    "collection.anki21b": zstdRawFrame(buildCollectionBytesV18()),
    "collection.anki2": strToU8("legacy stub — please update to the latest Anki version"),
    // Modern exports zstd-compress the media manifest too.
    media: zstdRawFrame(protobufMediaManifest(names)),
    ...mediaBlobs(),
  });
}

// CardTemplateConfig: field 1 = qfmt, field 2 = afmt.
function tmplConfig(qfmt: string, afmt: string): Uint8Array {
  return new Uint8Array([...protoString(1, qfmt), ...protoString(2, afmt)]);
}
// NotetypeConfig: field 1 = kind (1 = cloze, omitted ⇒ normal), field 3 = css.
function notetypeConfig(kind: number, css: string): Uint8Array {
  return new Uint8Array([...(kind ? protoInt(1, kind) : []), ...protoString(3, css)]);
}
function protoString(field: number, value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [(field << 3) | 2, ...protoVarint(bytes.length), ...bytes];
}
function protoInt(field: number, value: number): number[] {
  return [(field << 3) | 0, ...protoVarint(value)];
}

// A zstd frame carrying the data in raw (uncompressed) blocks. Single-segment,
// 4-byte content size; blocks capped at 128 KiB - 1.
function zstdRawFrame(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 128 * 1024 - 1;
  const out: number[] = [0x28, 0xb5, 0x2f, 0xfd, 0xa0]; // magic + frame-header descriptor
  const size = data.length;
  out.push(size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff);
  let offset = 0;
  do {
    const blockSize = Math.min(data.length - offset, MAX_BLOCK);
    const last = offset + blockSize >= data.length ? 1 : 0;
    const header = (blockSize << 3) | last; // block type 0 = raw
    out.push(header & 0xff, (header >>> 8) & 0xff, (header >>> 16) & 0xff);
    for (let i = 0; i < blockSize; i++) out.push(data[offset + i]);
    offset += blockSize;
    if (last) break;
  } while (offset < data.length);
  return new Uint8Array(out);
}

// Encode a protobuf MediaEntries message: repeated MediaEntry (field 1), each
// with a string name (field 1), keyed by position.
function protobufMediaManifest(names: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const out: number[] = [];
  for (const name of names) {
    const nameBytes = [...encoder.encode(name)];
    const entry = [(1 << 3) | 2, ...protoVarint(nameBytes.length), ...nameBytes];
    out.push((1 << 3) | 2, ...protoVarint(entry.length), ...entry);
  }
  return new Uint8Array(out);
}

function protoVarint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
  return out;
}
