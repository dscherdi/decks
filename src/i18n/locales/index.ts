import { en, type Translations } from "./en";
import { de } from "./de";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import { ru } from "./ru";
import { zh } from "./zh";
import { ja } from "./ja";
import { hi } from "./hi";
import { sq } from "./sq";
import { ar } from "./ar";
import { tr } from "./tr";
import { zhTW } from "./zhTW";

export type LanguageCode =
  | "en"
  | "de"
  | "es"
  | "fr"
  | "it"
  | "ru"
  | "zh"
  | "ja"
  | "hi"
  | "sq"
  | "ar"
  | "tr"
  | "zh-TW";

export type LanguagePreference = "auto" | LanguageCode;

export const LOCALES: Record<LanguageCode, Translations> = {
  en,
  de,
  es,
  fr,
  it,
  ru,
  zh,
  ja,
  hi,
  sq,
  ar,
  tr,
  "zh-TW": zhTW,
};

export const SUPPORTED_LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "hi", label: "हिन्दी" },
  { code: "sq", label: "Shqip" },
  { code: "ar", label: "العربية" },
  { code: "tr", label: "Türkçe" },
  { code: "zh-TW", label: "繁體中文" },
];

export type { Translations } from "./en";
