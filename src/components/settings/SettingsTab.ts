import {
  App,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  DropdownComponent,
  ButtonComponent,
  normalizePath,
  getLanguage,
} from "obsidian";
import type { DecksSettings } from "../../settings";
import {
  type ReviewShortcuts,
  DEFAULT_REVIEW_SHORTCUTS,
  displayShortcutKey,
  normalizeShortcutKey,
  matchesShortcut,
} from "../../utils/shortcuts";
import { BackupService } from "../../services/BackupService";
import DecksPlugin from "@/main";
import type { IDatabaseService } from "@/database/DatabaseFactory";
import type { FsrsWeightSet } from "@/database/types";
import { Logger } from "@/utils/logging";
import { OptimizeFsrsModal } from "./OptimizeFsrsModal";
import { resolveModelId } from "@/utils/ai-model-options";
import { docUrl } from "../../utils/docs";
import {
  type AiProviderId,
  DECKS_PRO_DEFAULT_BASE_URL,
  DECKS_PRO_SITE_URL,
  I18n,
  type LanguagePreference,
  PROVIDER_MODELS,
  SUPPORTED_LANGUAGES,
} from "@decks/core";

/**
 * Apple's "Download on the App Store" badge, inlined as a data URI.
 *
 * Embedded rather than linked to Apple's copy on purpose: a remote image would
 * make settings reach out to Apple's servers every time someone opened it, and
 * a local-first flashcard plugin should not be doing that. It also means the
 * badge still renders offline. The artwork itself is unmodified.
 */
const APP_STORE_BADGE =
  "data:image/svg+xml;base64,PHN2ZyBpZD0ibGl2ZXR5cGUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgd2lkdGg9IjExOS42NjQwNyIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDExOS42NjQwNyA0MCI+CiAgPHRpdGxlPkRvd25sb2FkX29uX3RoZV9BcHBfU3RvcmVfQmFkZ2VfVVMtVUtfUkdCX2Jsa180U1ZHXzA5MjkxNzwvdGl0bGU+CiAgPGc+CiAgICA8Zz4KICAgICAgPGc+CiAgICAgICAgPHBhdGggZD0iTTExMC4xMzQ3NywwSDkuNTM0NjhjLS4zNjY3LDAtLjcyOSwwLTEuMDk0NzMuMDAyLS4zMDYxNS4wMDItLjYwOTg2LjAwNzgxLS45MTg5NS4wMTI3QTEzLjIxNDc2LDEzLjIxNDc2LDAsMCwwLDUuNTE3MS4xOTE0MWE2LjY2NTA5LDYuNjY1MDksMCwwLDAtMS45MDA4OC42MjdBNi40Mzc3OSw2LjQzNzc5LDAsMCwwLDEuOTk3NTcsMS45OTcwNyw2LjI1ODQ0LDYuMjU4NDQsMCwwLDAsLjgxOTM1LDMuNjE4MTZhNi42MDExOSw2LjYwMTE5LDAsMCwwLS42MjUsMS45MDMzMiwxMi45OTMsMTIuOTkzLDAsMCwwLS4xNzkyLDIuMDAyQy4wMDU4Nyw3LjgzMDA4LjAwNDg5LDguMTM3NywwLDguNDQ0MzRWMzEuNTU4NmMuMDA0ODkuMzEwNS4wMDU4Ny42MTEzLjAxNTE1LjkyMTlhMTIuOTkyMzIsMTIuOTkyMzIsMCwwLDAsLjE3OTIsMi4wMDE5LDYuNTg3NTYsNi41ODc1NiwwLDAsMCwuNjI1LDEuOTA0M0E2LjIwNzc4LDYuMjA3NzgsMCwwLDAsMS45OTc1NywzOC4wMDFhNi4yNzQ0NSw2LjI3NDQ1LDAsMCwwLDEuNjE4NjUsMS4xNzg3LDYuNzAwODIsNi43MDA4MiwwLDAsMCwxLjkwMDg4LjYzMDgsMTMuNDU1MTQsMTMuNDU1MTQsMCwwLDAsMi4wMDM5LjE3NjhjLjMwOTA5LjAwNjguNjEyOC4wMTA3LjkxODk1LjAxMDdDOC44MDU2Nyw0MCw5LjE2OCw0MCw5LjUzNDY4LDQwSDExMC4xMzQ3N2MuMzU5NCwwLC43MjQ2LDAsMS4wODQtLjAwMi4zMDQ3LDAsLjYxNzItLjAwMzkuOTIxOS0uMDEwN2ExMy4yNzksMTMuMjc5LDAsMCwwLDItLjE3NjgsNi44MDQzMiw2LjgwNDMyLDAsMCwwLDEuOTA4Mi0uNjMwOCw2LjI3NzQyLDYuMjc3NDIsMCwwLDAsMS42MTcyLTEuMTc4Nyw2LjM5NDgyLDYuMzk0ODIsMCwwLDAsMS4xODE2LTEuNjE0Myw2LjYwNDEzLDYuNjA0MTMsMCwwLDAsLjYxOTEtMS45MDQzLDEzLjUwNjQzLDEzLjUwNjQzLDAsMCwwLC4xODU2LTIuMDAxOWMuMDAzOS0uMzEwNi4wMDM5LS42MTE0LjAwMzktLjkyMTkuMDA3OC0uMzYzMy4wMDc4LS43MjQ2LjAwNzgtMS4wOTM4VjkuNTM2MTNjMC0uMzY2MjEsMC0uNzI5NDktLjAwNzgtMS4wOTE3OSwwLS4zMDY2NCwwLS42MTQyNi0uMDAzOS0uOTIwOWExMy41MDcxLDEzLjUwNzEsMCwwLDAtLjE4NTYtMi4wMDIsNi42MTc3LDYuNjE3NywwLDAsMC0uNjE5MS0xLjkwMzMyLDYuNDY2MTksNi40NjYxOSwwLDAsMC0yLjc5ODgtMi43OTk4LDYuNzY3NTQsNi43Njc1NCwwLDAsMC0xLjkwODItLjYyNywxMy4wNDM5NCwxMy4wNDM5NCwwLDAsMC0yLS4xNzY3NmMtLjMwNDctLjAwNDg4LS42MTcyLS4wMTA3NC0uOTIxOS0uMDEyNjktLjM1OTQtLjAwMi0uNzI0Ni0uMDAyLTEuMDg0LS4wMDJaIiBzdHlsZT0iZmlsbDogI2E2YTZhNiIvPgogICAgICAgIDxwYXRoIGQ9Ik04LjQ0NDgzLDM5LjEyNWMtLjMwNDY4LDAtLjYwMi0uMDAzOS0uOTA0MjktLjAxMDdhMTIuNjg3MTQsMTIuNjg3MTQsMCwwLDEtMS44NjkxNC0uMTYzMSw1Ljg4MzgxLDUuODgzODEsMCwwLDEtMS42NTY3NC0uNTQ3OSw1LjQwNTczLDUuNDA1NzMsMCwwLDEtMS4zOTctMS4wMTY2LDUuMzIwODIsNS4zMjA4MiwwLDAsMS0xLjAyMDUxLTEuMzk2NSw1LjcyMTg2LDUuNzIxODYsMCwwLDEtLjU0My0xLjY1NzIsMTIuNDEzNTEsMTIuNDEzNTEsMCwwLDEtLjE2NjUtMS44NzVjLS4wMDYzNC0uMjEwOS0uMDE0NjQtLjkxMzEtLjAxNDY0LS45MTMxVjguNDQ0MzRTLjg4MTg1LDcuNzUyOTMuODg3Nyw3LjU0OThhMTIuMzcwMzksMTIuMzcwMzksMCwwLDEsLjE2NTUzLTEuODcyMDcsNS43NTU1LDUuNzU1NSwwLDAsMSwuNTQzNDYtMS42NjIxQTUuMzczNDksNS4zNzM0OSwwLDAsMSwyLjYxMTgzLDIuNjE3NjgsNS41NjU0Myw1LjU2NTQzLDAsMCwxLDQuMDE0MTcsMS41OTUyMWE1LjgyMzA5LDUuODIzMDksMCwwLDEsMS42NTMzMi0uNTQzOTRBMTIuNTg1ODksMTIuNTg1ODksMCwwLDEsNy41NDMuODg3MjFMOC40NDUzMi44NzVIMTExLjIxMzg3bC45MTMxLjAxMjdhMTIuMzg0OTMsMTIuMzg0OTMsMCwwLDEsMS44NTg0LjE2MjU5LDUuOTM4MzMsNS45MzgzMywwLDAsMSwxLjY3MDkuNTQ3ODUsNS41OTM3NCw1LjU5Mzc0LDAsMCwxLDIuNDE1LDIuNDE5OTMsNS43NjI2Nyw1Ljc2MjY3LDAsMCwxLC41MzUyLDEuNjQ4OTIsMTIuOTk1LDEyLjk5NSwwLDAsMSwuMTczOCwxLjg4NzIxYy4wMDI5LjI4MzIuMDAyOS41ODc0LjAwMjkuODkwMTQuMDA3OS4zNzUuMDA3OS43MzE5My4wMDc5LDEuMDkxNzlWMzAuNDY0OGMwLC4zNjMzLDAsLjcxNzgtLjAwNzksMS4wNzUyLDAsLjMyNTIsMCwuNjIzMS0uMDAzOS45Mjk3YTEyLjczMTI2LDEyLjczMTI2LDAsMCwxLS4xNzA5LDEuODUzNSw1LjczOSw1LjczOSwwLDAsMS0uNTQsMS42Nyw1LjQ4MDI5LDUuNDgwMjksMCwwLDEtMS4wMTU2LDEuMzg1Nyw1LjQxMjksNS40MTI5LDAsMCwxLTEuMzk5NCwxLjAyMjUsNS44NjE2OCw1Ljg2MTY4LDAsMCwxLTEuNjY4LjU0OTgsMTIuNTQyMTgsMTIuNTQyMTgsMCwwLDEtMS44NjkyLjE2MzFjLS4yOTI5LjAwNjgtLjU5OTYuMDEwNy0uODk3NC4wMTA3bC0xLjA4NC4wMDJaIi8+CiAgICAgIDwvZz4KICAgICAgPGcgaWQ9Il9Hcm91cF8iIGRhdGEtbmFtZT0iJmx0O0dyb3VwJmd0OyI+CiAgICAgICAgPGcgaWQ9Il9Hcm91cF8yIiBkYXRhLW5hbWU9IiZsdDtHcm91cCZndDsiPgogICAgICAgICAgPGcgaWQ9Il9Hcm91cF8zIiBkYXRhLW5hbWU9IiZsdDtHcm91cCZndDsiPgogICAgICAgICAgICA8cGF0aCBpZD0iX1BhdGhfIiBkYXRhLW5hbWU9IiZsdDtQYXRoJmd0OyIgZD0iTTI0Ljc2ODg4LDIwLjMwMDY4YTQuOTQ4ODEsNC45NDg4MSwwLDAsMSwyLjM1NjU2LTQuMTUyMDYsNS4wNjU2Niw1LjA2NTY2LDAsMCwwLTMuOTkxMTYtMi4xNTc2OGMtMS42NzkyNC0uMTc2MjYtMy4zMDcxOSwxLjAwNDgzLTQuMTYyOSwxLjAwNDgzLS44NzIyNywwLTIuMTg5NzctLjk4NzMzLTMuNjA4NS0uOTU4MTRhNS4zMTUyOSw1LjMxNTI5LDAsMCwwLTQuNDcyOTIsMi43Mjc4N2MtMS45MzQsMy4zNDg0Mi0uNDkxNDEsOC4yNjk0NywxLjM2MTIsMTAuOTc2MDguOTI2OSwxLjMyNTM1LDIuMDEwMTgsMi44MDU4LDMuNDI3NjMsMi43NTMzLDEuMzg3MDYtLjA1NzUzLDEuOTA1MS0uODg0NDgsMy41Nzk0LS44ODQ0OCwxLjY1ODc2LDAsMi4xNDQ3OS44ODQ0OCwzLjU5MS44NTExLDEuNDg4MzgtLjAyNDE2LDIuNDI2MTMtMS4zMzEyNCwzLjMyMDUxLTIuNjY5MTRhMTAuOTYyLDEwLjk2MiwwLDAsMCwxLjUxODQyLTMuMDkyNTFBNC43ODIwNSw0Ljc4MjA1LDAsMCwxLDI0Ljc2ODg4LDIwLjMwMDY4WiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgICAgICAgPHBhdGggaWQ9Il9QYXRoXzIiIGRhdGEtbmFtZT0iJmx0O1BhdGgmZ3Q7IiBkPSJNMjIuMDM3MjUsMTIuMjEwODlhNC44NzI0OCw0Ljg3MjQ4LDAsMCwwLDEuMTE0NTItMy40OTA2Miw0Ljk1NzQ2LDQuOTU3NDYsMCwwLDAtMy4yMDc1OCwxLjY1OTYxLDQuNjM2MzQsNC42MzYzNCwwLDAsMC0xLjE0MzcxLDMuMzYxMzlBNC4wOTkwNSw0LjA5OTA1LDAsMCwwLDIyLjAzNzI1LDEyLjIxMDg5WiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgICAgIDwvZz4KICAgICAgICA8L2c+CiAgICAgICAgPGc+CiAgICAgICAgICA8cGF0aCBkPSJNNDIuMzAyMjcsMjcuMTM5NjVoLTQuNzMzNGwtMS4xMzY3MiwzLjM1NjQ1SDM0LjQyNzI3bDQuNDgzNC0xMi40MThoMi4wODNsNC40ODM0LDEyLjQxOEg0My40MzhaTTM4LjA1OTEsMjUuNTkwODJoMy43NTJsLTEuODQ5NjEtNS40NDcyN2gtLjA1MTc2WiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgICAgIDxwYXRoIGQ9Ik01NS4xNTk2OSwyNS45Njk3M2MwLDIuODEzNDgtMS41MDU4Niw0LjYyMTA5LTMuNzc4MzIsNC42MjEwOWEzLjA2OTMsMy4wNjkzLDAsMCwxLTIuODQ4NjMtMS41ODRoLS4wNDN2NC40ODQzOGgtMS44NTg0VjIxLjQ0MjM4SDQ4LjQzMDJ2MS41MDU4NmguMDM0MThhMy4yMTE2MiwzLjIxMTYyLDAsMCwxLDIuODgyODEtMS42MDA1OUM1My42NDUsMjEuMzQ3NjYsNTUuMTU5NjksMjMuMTY0MDYsNTUuMTU5NjksMjUuOTY5NzNabS0xLjkxMDE2LDBjMC0xLjgzMy0uOTQ3MjctMy4wMzgwOS0yLjM5MjU4LTMuMDM4MDktMS40MTk5MiwwLTIuMzc1LDEuMjMwNDctMi4zNzUsMy4wMzgwOSwwLDEuODI0MjIuOTU1MDgsMy4wNDU5LDIuMzc1LDMuMDQ1OUM1Mi4zMDIyNywyOS4wMTU2Myw1My4yNDk1MywyNy44MTkzNCw1My4yNDk1MywyNS45Njk3M1oiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgICA8cGF0aCBkPSJNNjUuMTI0NTMsMjUuOTY5NzNjMCwyLjgxMzQ4LTEuNTA1ODYsNC42MjEwOS0zLjc3ODMyLDQuNjIxMDlhMy4wNjkzLDMuMDY5MywwLDAsMS0yLjg0ODYzLTEuNTg0aC0uMDQzdjQuNDg0MzhoLTEuODU4NFYyMS40NDIzOEg1OC4zOTV2MS41MDU4NmguMDM0MThBMy4yMTE2MiwzLjIxMTYyLDAsMCwxLDYxLjMxMiwyMS4zNDc2NkM2My42MDk4OCwyMS4zNDc2Niw2NS4xMjQ1MywyMy4xNjQwNiw2NS4xMjQ1MywyNS45Njk3M1ptLTEuOTEwMTYsMGMwLTEuODMzLS45NDcyNy0zLjAzODA5LTIuMzkyNTgtMy4wMzgwOS0xLjQxOTkyLDAtMi4zNzUsMS4yMzA0Ny0yLjM3NSwzLjAzODA5LDAsMS44MjQyMi45NTUwOCwzLjA0NTksMi4zNzUsMy4wNDU5QzYyLjI2NzExLDI5LjAxNTYzLDYzLjIxNDM4LDI3LjgxOTM0LDYzLjIxNDM4LDI1Ljk2OTczWiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgICAgIDxwYXRoIGQ9Ik03MS43MTA0NywyNy4wMzYxM2MuMTM3NywxLjIzMTQ1LDEuMzM0LDIuMDQsMi45Njg3NSwyLjA0LDEuNTY2NDEsMCwyLjY5MzM2LS44MDg1OSwyLjY5MzM2LTEuOTE4OTUsMC0uOTYzODctLjY3OTY5LTEuNTQxLTIuMjg5MDYtMS45MzY1MmwtMS42MDkzNy0uMzg3N2MtMi4yODAyNy0uNTUwNzgtMy4zMzg4Ny0xLjYxNzE5LTMuMzM4ODctMy4zNDc2NiwwLTIuMTQyNTgsMS44NjcxOS0zLjYxNDI2LDQuNTE4NTUtMy42MTQyNiwyLjYyNCwwLDQuNDIyODUsMS40NzE2OCw0LjQ4MzQsMy42MTQyNmgtMS44NzZjLS4xMTIzLTEuMjM5MjYtMS4xMzY3Mi0xLjk4NzMtMi42MzM3OS0xLjk4NzNzLTIuNTIxNDguNzU2ODQtMi41MjE0OCwxLjg1ODRjMCwuODc3OTMuNjU0MywxLjM5NDUzLDIuMjU0ODgsMS43OWwxLjM2ODE2LjMzNTk0YzIuNTQ3ODUuNjAyNTQsMy42MDY0NSwxLjYyNiwzLjYwNjQ1LDMuNDQyMzgsMCwyLjMyMzI0LTEuODUwNTksMy43NzgzMi00Ljc5Mzk1LDMuNzc4MzItMi43NTM5MSwwLTQuNjEzMjgtMS40MjA5LTQuNzMzNC0zLjY2N1oiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgICA8cGF0aCBkPSJNODMuMzQ2MjEsMTkuMjk5OHYyLjE0MjU4aDEuNzIxNjh2MS40NzE2OEg4My4zNDYyMXY0Ljk5MTIxYzAsLjc3NTM5LjM0NDczLDEuMTM2NzIsMS4xMDE1NiwxLjEzNjcyYTUuODA3NTIsNS44MDc1MiwwLDAsMCwuNjExMzMtLjA0M3YxLjQ2Mjg5YTUuMTAzNTEsNS4xMDM1MSwwLDAsMS0xLjAzMjIzLjA4NTk0Yy0xLjgzMywwLTIuNTQ3ODUtLjY4ODQ4LTIuNTQ3ODUtMi40NDQzNFYyMi45MTQwNkg4MC4xNjI2MlYyMS40NDIzOEg4MS40NzlWMTkuMjk5OFoiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgICA8cGF0aCBkPSJNODYuMDY1LDI1Ljk2OTczYzAtMi44NDg2MywxLjY3NzczLTQuNjM4NjcsNC4yOTM5NS00LjYzODY3LDIuNjI1LDAsNC4yOTQ5MiwxLjc5LDQuMjk0OTIsNC42Mzg2NywwLDIuODU2NDUtMS42NjExMyw0LjYzODY3LTQuMjk0OTIsNC42Mzg2N0M4Ny43MjYwOSwzMC42MDg0LDg2LjA2NSwyOC44MjYxNyw4Ni4wNjUsMjUuOTY5NzNabTYuNjk1MzEsMGMwLTEuOTU0MS0uODk1NTEtMy4xMDc0Mi0yLjQwMTM3LTMuMTA3NDJzLTIuNDAwMzksMS4xNjIxMS0yLjQwMDM5LDMuMTA3NDJjMCwxLjk2MTkxLjg5NDUzLDMuMTA2NDUsMi40MDAzOSwzLjEwNjQ1UzkyLjc2MDI3LDI3LjkzMTY0LDkyLjc2MDI3LDI1Ljk2OTczWiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgICAgIDxwYXRoIGQ9Ik05Ni4xODYwNiwyMS40NDIzOGgxLjc3MjQ2djEuNTQxaC4wNDNhMi4xNTk0LDIuMTU5NCwwLDAsMSwyLjE3NzczLTEuNjM1NzQsMi44NjYxNiwyLjg2NjE2LDAsMCwxLC42MzY3Mi4wNjkzNHYxLjczODI4YTIuNTk3OTQsMi41OTc5NCwwLDAsMC0uODM1LS4xMTIzLDEuODcyNjQsMS44NzI2NCwwLDAsMC0xLjkzNjUyLDIuMDgzdjUuMzcwMTJoLTEuODU4NFoiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgICA8cGF0aCBkPSJNMTA5LjM4NDMsMjcuODM2OTFjLS4yNSwxLjY0MzU1LTEuODUwNTksMi43NzE0OC0zLjg5ODQ0LDIuNzcxNDgtMi42MzM3OSwwLTQuMjY4NTUtMS43NjQ2NS00LjI2ODU1LTQuNTk1NywwLTIuODM5ODQsMS42NDM1NS00LjY4MTY0LDQuMTkwNDMtNC42ODE2NCwyLjUwNDg4LDAsNC4wODAwOCwxLjcyMDcsNC4wODAwOCw0LjQ2NTgydi42MzY3MmgtNi4zOTQ1M3YuMTEyM2EyLjM1OCwyLjM1OCwwLDAsMCwyLjQzNTU1LDIuNTY0NDUsMi4wNDgzNCwyLjA0ODM0LDAsMCwwLDIuMDkwODItMS4yNzM0NFptLTYuMjgyMjMtMi43MDIxNWg0LjUyNjM3YTIuMTc3MywyLjE3NzMsMCwwLDAtMi4yMjA3LTIuMjk3ODVBMi4yOTIsMi4yOTIsMCwwLDAsMTAzLjEwMjA3LDI1LjEzNDc3WiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgICA8L2c+CiAgICAgIDwvZz4KICAgIDwvZz4KICAgIDxnIGlkPSJfR3JvdXBfNCIgZGF0YS1uYW1lPSImbHQ7R3JvdXAmZ3Q7Ij4KICAgICAgPGc+CiAgICAgICAgPHBhdGggZD0iTTM3LjgyNjE5LDguNzMxYTIuNjM5NjQsMi42Mzk2NCwwLDAsMSwyLjgwNzYyLDIuOTY0ODRjMCwxLjkwNjI1LTEuMDMwMjcsMy4wMDItMi44MDc2MiwzLjAwMkgzNS42NzA5MlY4LjczMVptLTEuMjI4NTIsNS4xMjNoMS4xMjVhMS44NzU4OCwxLjg3NTg4LDAsMCwwLDEuOTY3NzctMi4xNDYsMS44ODEsMS44ODEsMCwwLDAtMS45Njc3Ny0yLjEzMzc5aC0xLjEyNVoiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgPHBhdGggZD0iTTQxLjY4MDY4LDEyLjQ0NDM0YTIuMTMzMjMsMi4xMzMyMywwLDEsMSw0LjI0NzA3LDAsMi4xMzM1OCwyLjEzMzU4LDAsMSwxLTQuMjQ3MDcsMFptMy4zMzMsMGMwLS45NzYwNy0uNDM4NDgtMS41NDY4Ny0xLjIwOC0xLjU0Njg3LS43NzI0NiwwLTEuMjA3LjU3MDgtMS4yMDcsMS41NDY4OCwwLC45ODM4OS40MzQ1NywxLjU1MDI5LDEuMjA3LDEuNTUwMjlDNDQuNTc1MjIsMTMuOTk0NjMsNDUuMDEzNjksMTMuNDI0MzIsNDUuMDEzNjksMTIuNDQ0MzRaIiBzdHlsZT0iZmlsbDogI2ZmZiIvPgogICAgICAgIDxwYXRoIGQ9Ik01MS41NzMyNiwxNC42OTc3NWgtLjkyMTg3bC0uOTMwNjYtMy4zMTY0MWgtLjA3MDMxbC0uOTI2NzYsMy4zMTY0MWgtLjkxMzA5bC0xLjI0MTIxLTQuNTAyOTNoLjkwMTM3bC44MDY2NCwzLjQzNmguMDY2NDFsLjkyNTc4LTMuNDM2aC44NTI1NGwuOTI1NzgsMy40MzZoLjA3MDMxbC44MDI3My0zLjQzNmguODg4NjdaIiBzdHlsZT0iZmlsbDogI2ZmZiIvPgogICAgICAgIDxwYXRoIGQ9Ik01My44NTM1NCwxMC4xOTQ4Mkg1NC43MDl2LjcxNTMzaC4wNjY0MWExLjM0OCwxLjM0OCwwLDAsMSwxLjM0Mzc1LS44MDIyNSwxLjQ2NDU2LDEuNDY0NTYsMCwwLDEsMS41NTg1OSwxLjY3NDh2Mi45MTVoLS44ODg2N1YxMi4wMDU4NmMwLS43MjM2My0uMzE0NDUtMS4wODM1LS45NzE2OC0xLjA4MzVhMS4wMzI5NCwxLjAzMjk0LDAsMCwwLTEuMDc1MiwxLjE0MTExdjIuNjM0MjhoLS44ODg2N1oiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgPHBhdGggZD0iTTU5LjA5Mzc3LDguNDM3aC44ODg2N3Y2LjI2MDc0aC0uODg4NjdaIiBzdHlsZT0iZmlsbDogI2ZmZiIvPgogICAgICAgIDxwYXRoIGQ9Ik02MS4yMTc3OSwxMi40NDQzNGEyLjEzMzQ2LDIuMTMzNDYsMCwxLDEsNC4yNDc1NiwwLDIuMTMzOCwyLjEzMzgsMCwxLDEtNC4yNDc1NiwwWm0zLjMzMywwYzAtLjk3NjA3LS40Mzg0OC0xLjU0Njg3LTEuMjA4LTEuNTQ2ODctLjc3MjQ2LDAtMS4yMDcuNTcwOC0xLjIwNywxLjU0Njg4LDAsLjk4Mzg5LjQzNDU3LDEuNTUwMjksMS4yMDcsMS41NTAyOUM2NC4xMTIzMiwxMy45OTQ2Myw2NC41NTA4LDEzLjQyNDMyLDY0LjU1MDgsMTIuNDQ0MzRaIiBzdHlsZT0iZmlsbDogI2ZmZiIvPgogICAgICAgIDxwYXRoIGQ9Ik02Ni40MDA5LDEzLjQyNDMyYzAtLjgxMDU1LjYwMzUyLTEuMjc3ODMsMS42NzQ4LTEuMzQ0MjRsMS4yMTk3My0uMDcwMzF2LS4zODg2N2MwLS40NzU1OS0uMzE0NDUtLjc0NDE0LS45MjE4Ny0uNzQ0MTQtLjQ5NjA5LDAtLjgzOTg0LjE4MjEzLS45Mzg0OC41MDA0OWgtLjg2MDM1Yy4wOTA4Mi0uNzczNDQuODE4MzYtMS4yNjk1MywxLjgzOTg0LTEuMjY5NTMsMS4xMjg5MSwwLDEuNzY1NjMuNTYyLDEuNzY1NjMsMS41MTMxOHYzLjA3NjY2aC0uODU1NDd2LS42MzI4MWgtLjA3MDMxYTEuNTE1LDEuNTE1LDAsMCwxLTEuMzUyNTQuNzA3QTEuMzYwMjYsMS4zNjAyNiwwLDAsMSw2Ni40MDA5LDEzLjQyNDMyWm0yLjg5NDUzLS4zODQ3N3YtLjM3NjQ2bC0xLjA5OTYxLjA3MDMxYy0uNjIwMTIuMDQxNS0uOTAxMzcuMjUyNDQtLjkwMTM3LjY0OTQxLDAsLjQwNTI3LjM1MTU2LjY0MTExLjgzNS42NDExMUExLjA2MTUsMS4wNjE1LDAsMCwwLDY5LjI5NTQzLDEzLjAzOTU1WiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgICA8cGF0aCBkPSJNNzEuMzQ4MTYsMTIuNDQ0MzRjMC0xLjQyMjg1LjczMTQ1LTIuMzI0MjIsMS44NjkxNC0yLjMyNDIyYTEuNDg0LDEuNDg0LDAsMCwxLDEuMzgwODYuNzloLjA2NjQxVjguNDM3aC44ODg2N3Y2LjI2MDc0aC0uODUxNTZ2LS43MTE0M2gtLjA3MDMxYTEuNTYyODQsMS41NjI4NCwwLDAsMS0xLjQxNDA2Ljc4NTY0QzcyLjA3MTgsMTQuNzcyLDcxLjM0ODE2LDEzLjg3MDYxLDcxLjM0ODE2LDEyLjQ0NDM0Wm0uOTE4LDBjMCwuOTU1MDguNDUwMiwxLjUyOTc5LDEuMjAzMTMsMS41Mjk3OS43NDksMCwxLjIxMTkxLS41ODMsMS4yMTE5MS0xLjUyNTg4LDAtLjkzODQ4LS40Njc3Ny0xLjUyOTc5LTEuMjExOTEtMS41Mjk3OUM3Mi43MjEyMSwxMC45MTg0Niw3Mi4yNjYxMywxMS40OTcwNyw3Mi4yNjYxMywxMi40NDQzNFoiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgPHBhdGggZD0iTTc5LjIzLDEyLjQ0NDM0YTIuMTMzMjMsMi4xMzMyMywwLDEsMSw0LjI0NzA3LDAsMi4xMzM1OCwyLjEzMzU4LDAsMSwxLTQuMjQ3MDcsMFptMy4zMzMsMGMwLS45NzYwNy0uNDM4NDgtMS41NDY4Ny0xLjIwOC0xLjU0Njg3LS43NzI0NiwwLTEuMjA3LjU3MDgtMS4yMDcsMS41NDY4OCwwLC45ODM4OS40MzQ1NywxLjU1MDI5LDEuMjA3LDEuNTUwMjlDODIuMTI0NTMsMTMuOTk0NjMsODIuNTYzLDEzLjQyNDMyLDgyLjU2MywxMi40NDQzNFoiIHN0eWxlPSJmaWxsOiAjZmZmIi8+CiAgICAgICAgPHBhdGggZD0iTTg0LjY2OTQ1LDEwLjE5NDgyaC44NTU0N3YuNzE1MzNoLjA2NjQxYTEuMzQ4LDEuMzQ4LDAsMCwxLDEuMzQzNzUtLjgwMjI1LDEuNDY0NTYsMS40NjQ1NiwwLDAsMSwxLjU1ODU5LDEuNjc0OHYyLjkxNUg4Ny42MDVWMTIuMDA1ODZjMC0uNzIzNjMtLjMxNDQ1LTEuMDgzNS0uOTcxNjgtMS4wODM1YTEuMDMyOTQsMS4wMzI5NCwwLDAsMC0xLjA3NTIsMS4xNDExMXYyLjYzNDI4aC0uODg4NjdaIiBzdHlsZT0iZmlsbDogI2ZmZiIvPgogICAgICAgIDxwYXRoIGQ9Ik05My41MTUxNiw5LjA3MzczdjEuMTQxNmguOTc1NTl2Ljc0ODU0aC0uOTc1NTlWMTMuMjc5M2MwLC40NzE2OC4xOTQzNC42NzgyMi42MzY3Mi42NzgyMmEyLjk2NjU3LDIuOTY2NTcsMCwwLDAsLjMzODg3LS4wMjA1MXYuNzQwMjNhMi45MTU1LDIuOTE1NSwwLDAsMS0uNDgzNC4wNDU0MWMtLjk4ODI4LDAtMS4zODE4NC0uMzQ3NjYtMS4zODE4NC0xLjIxNTgydi0yLjU0M2gtLjcxNDg0di0uNzQ4NTRoLjcxNDg0VjkuMDczNzNaIiBzdHlsZT0iZmlsbDogI2ZmZiIvPgogICAgICAgIDxwYXRoIGQ9Ik05NS43MDQ2MSw4LjQzN2guODgwODZ2Mi40ODE0NWguMDcwMzFhMS4zODU2LDEuMzg1NiwwLDAsMSwxLjM3My0uODA2NjQsMS40ODMzOSwxLjQ4MzM5LDAsMCwxLDEuNTUwNzgsMS42Nzg3MXYyLjkwNzIzSDk4LjY5di0yLjY4OGMwLS43MTkyNC0uMzM1LTEuMDgzNS0uOTYyODktMS4wODM1YTEuMDUxOTQsMS4wNTE5NCwwLDAsMC0xLjEzMzc5LDEuMTQxNnYyLjYyOTg4aC0uODg4NjdaIiBzdHlsZT0iZmlsbDogI2ZmZiIvPgogICAgICAgIDxwYXRoIGQ9Ik0xMDQuNzYxMjUsMTMuNDgxOTNhMS44MjgsMS44MjgsMCwwLDEtMS45NTExNywxLjMwMjczQTIuMDQ1MzEsMi4wNDUzMSwwLDAsMSwxMDAuNzMsMTIuNDYwNDVhMi4wNzY4NSwyLjA3Njg1LDAsMCwxLDIuMDc2MTctMi4zNTI1NGMxLjI1MjkzLDAsMi4wMDg3OS44NTYsMi4wMDg3OSwyLjI3VjEyLjY4OGgtMy4xNzk2OXYuMDQ5OGExLjE5MDIsMS4xOTAyLDAsMCwwLDEuMTk5MjIsMS4yOSwxLjA3OTM0LDEuMDc5MzQsMCwwLDAsMS4wNzEyOS0uNTQ1OVptLTMuMTI2LTEuNDUxMTdoMi4yNzQ0MWExLjA4NjQ3LDEuMDg2NDcsMCwwLDAtMS4xMDg0LTEuMTY2NUExLjE1MTYyLDEuMTUxNjIsMCwwLDAsMTAxLjYzNTI3LDEyLjAzMDc2WiIgc3R5bGU9ImZpbGw6ICNmZmYiLz4KICAgICAgPC9nPgogICAgPC9nPgogIDwvZz4KPC9zdmc+";

const APP_STORE_URL = "https://apps.apple.com/app/id6801156953";

export class DecksSettingTab extends PluginSettingTab {
  private settings: DecksSettings;
  private saveSettings: () => Promise<void>;
  private performSync: (force?: boolean) => Promise<void>;
  private refreshViewStats: () => Promise<void>;
  private restartBackgroundRefresh: () => void;
  private startBackgroundRefresh: () => void;
  private stopBackgroundRefresh: () => void;
  private purgeDatabase: () => Promise<void>;
  private backupService: BackupService;
  private plugin: DecksPlugin;
  private db: IDatabaseService;
  private logger: Logger;
  // Cancels an in-progress review-shortcut key capture (only one at a time).
  private cancelShortcutCapture?: () => void;
  // Tracks when the user explicitly chose "Custom…" in the model picker so the
  // free-text field stays open even while the typed id matches no preset.
  private aiModelCustom = false;
  private resyncTemplates: () => Promise<void>;

  constructor(
    app: App,
    plugin: DecksPlugin,
    settings: DecksSettings,
    db: IDatabaseService,
    saveSettings: () => Promise<void>,
    logger: Logger,
    performSync: (force?: boolean) => Promise<void>,
    refreshViewStats: () => Promise<void>,
    restartBackgroundRefresh: () => void,
    startBackgroundRefresh: () => void,
    stopBackgroundRefresh: () => void,
    purgeDatabase: () => Promise<void>,
    backupService: BackupService,
    resyncTemplates: () => Promise<void>
  ) {
    super(app, plugin);
    this.plugin = plugin;
    this.resyncTemplates = resyncTemplates;
    this.settings = settings;
    this.db = db;
    this.logger = logger;
    this.saveSettings = saveSettings;
    this.performSync = performSync;
    this.refreshViewStats = refreshViewStats;
    this.restartBackgroundRefresh = restartBackgroundRefresh;
    this.startBackgroundRefresh = startBackgroundRefresh;
    this.stopBackgroundRefresh = stopBackgroundRefresh;
    this.purgeDatabase = purgeDatabase;
    this.backupService = backupService;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addAppBanner(containerEl);
    this.addProBanner(containerEl);

    // Language
    this.addLanguageSettings(containerEl);

    // Review Session Settings
    this.addReviewSettings(containerEl);

    // Keyboard shortcuts (standalone section)
    this.addKeyboardShortcutSettings(containerEl);

    // Parsing Settings
    this.addParsingSettings(containerEl);

    // Card templates (folder → deck_templates cache)
    this.addTemplateSettings(containerEl);

    // Canvas Decks Settings
    this.addCanvasDecksSettings(containerEl);

    // UI Settings
    this.addUISettings(containerEl);

    // AI features
    this.addAiSettings(containerEl);

    // Backup Settings
    this.addBackupSettings(containerEl);

    // FSRS optimization (async: reads the active trained weight set from the DB)
    const fsrsContainer = containerEl.createDiv();
    this.addFsrsOptimizationSettings(fsrsContainer).catch((e) =>
      this.logger?.error?.("Failed to render FSRS settings", e)
    );

    // Debug Settings
    this.addDebugSettings(containerEl);

    // File locations (DB path, backups, sync logs)
    this.addPathsSettings(containerEl);

    // Database Management Settings
    this.addDatabaseSettings(containerEl);
  }

  // Template folder picker. Changing it rebuilds the template cache so cards
  // bind without a reload. The live preview of template faces lives in the
  // template file itself (a markdown codeblock postprocessor).
  private addTemplateSettings(containerEl: HTMLElement): void {
    const t = I18n.t.settings.templates;
    new Setting(containerEl)
      .setName(t.heading)
      .setHeading()
      .addExtraButton((b) =>
        b
          .setIcon("info")
          .setTooltip(I18n.t.help.docs)
          .onClick(() => window.open(docUrl("cards/templates"), "_blank"))
      );

    if (!this.settings.templates) this.settings.templates = { templateFolder: "" };

    const folderOptions: Record<string, string> = { "": t.folderDefault };
    this.app.vault.getAllFolders().forEach((folder) => {
      folderOptions[folder.path] = folder.path;
    });

    new Setting(containerEl)
      .setName(t.folder)
      .setDesc(t.folderDesc)
      .addDropdown((dropdown) => {
        Object.entries(folderOptions).forEach(([value, display]) => {
          dropdown.addOption(value, display);
        });
        dropdown
          .setValue(normalizePath(this.settings.templates?.templateFolder || ""))
          .onChange(async (value) => {
            if (!this.settings.templates) {
              this.settings.templates = { templateFolder: "" };
            }
            this.settings.templates.templateFolder = value
              ? normalizePath(value)
              : "";
            await this.saveSettings();
            await this.resyncTemplates();
          });
      });
  }

  private addAiSettings(containerEl: HTMLElement): void {
    const s = I18n.t.settings.ai;
    new Setting(containerEl)
      .setName(s.heading)
      .setHeading()
      .addExtraButton((b) =>
        b
          .setIcon("info")
          .setTooltip(I18n.t.help.docs)
          .onClick(() => window.open(docUrl("ai"), "_blank"))
      );

    // The provider/model/key fields render into their own container so toggling
    // "enabled" (or switching provider) rebuilds ONLY that container instead of
    // the whole settings tab. The enable toggle leads the block; the container
    // is appended after it so the provider fields render below.
    new Setting(containerEl)
      .setName(s.enabled)
      .setDesc(s.enabledDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.settings.ai.enabled).onChange(async (value) => {
          if (value === this.settings.ai.enabled) return;
          this.settings.ai.enabled = value;
          await this.saveSettings();
          this.plugin.getDecksView()?.applyAiEnabledUpdate(value);
          this.renderAiProviderSettings(subContainer);
        })
      );

    const subContainer = containerEl.createDiv();
    this.renderAiProviderSettings(subContainer);
  }

  private renderAiProviderSettings(containerEl: HTMLElement): void {
    containerEl.empty();
    if (!this.settings.ai.enabled) return;

    const s = I18n.t.settings.ai;
    const provider = this.settings.ai.provider;

    new Setting(containerEl)
      .setName(s.provider)
      .setDesc(s.providerDesc)
      .addDropdown((dd) =>
        dd
          .addOption("gemini", s.providerGemini)
          .addOption("openai", s.providerOpenai)
          .addOption("claude", s.providerClaude)
          .addOption("openai-compatible", s.providerLocal)
          .addOption("decks-pro", s.providerDecksPro)
          .setValue(provider)
          .onChange(async (value) => {
            if (value === this.settings.ai.provider) return;
            this.settings.ai.provider = value as AiProviderId;
            await this.saveSettings();
            // Rebuild only this sub-container (shows/hides the local URL field).
            this.renderAiProviderSettings(containerEl);
          })
      );

    this.renderModelSetting(containerEl, provider);

    if (provider === "openai-compatible") {
      new Setting(containerEl)
        .setName(s.localBaseUrl)
        .setDesc(s.localBaseUrlDesc)
        .addText((text) =>
          text
            .setValue(this.settings.ai.localBaseUrl)
            .onChange(async (value) => {
              this.settings.ai.localBaseUrl = value.trim();
              await this.saveSettings();
            })
        );
    }


    // Decks Pro authenticates by signing in; the other providers take an API key.
    const isPro = provider === "decks-pro";
    if (isPro) {
      this.renderDecksProAccount(containerEl);
      return;
    }

    // Credential lives in the non-synced AiKeyStore, never in data.json.
    new Setting(containerEl)
      .setName(s.apiKey)
      .setDesc(s.apiKeyDesc)
      .addText((text) => {
        text
          .setPlaceholder(s.apiKeyPlaceholder)
          .onChange(async (value) => {
            await this.plugin.aiKeyStore.set(provider, value);
          });
        text.inputEl.type = "password";
        // Block body is required: TextComponent.setValue() returns `this`, and
        // Obsidian components are thenables (BaseComponent.then). Returning the
        // component from a .then callback makes the Promise adopt it and recurse
        // through .then forever (hard freeze). The block returns undefined.
        void this.plugin.aiKeyStore.get(provider).then((k) => {
          text.setValue(k);
        });
      });
  }

  /**
   * Decks Pro account panel. Renders a signed-out prompt or the live account
   * state (subscription, quota, sign-out), plus the license-key fallback for
   * customers who bought before accounts existed.
   */
  private renderDecksProAccount(containerEl: HTMLElement): void {
    const s = I18n.t.settings.ai;

    const panel = containerEl.createDiv();
    const render = () => {
      panel.empty();
      void this.renderProAccountInto(panel, render);
    };
    render();

    // Development overrides: point the plugin at a locally running site and
    // worker so the sign-in hand-off can be exercised before deploying. Guarded
    // by the build-time flag, so these are stripped from release builds.
    if (__DECKS_DEV__) {
      new Setting(containerEl)
        .setName(s.serverUrl)
        .setDesc(s.serverUrlDesc)
        .addText((text) =>
          text
            .setPlaceholder(DECKS_PRO_DEFAULT_BASE_URL)
            .setValue(this.settings.ai.proBaseUrl ?? "")
            .onChange(async (value) => {
              this.settings.ai.proBaseUrl = value.trim();
              await this.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(s.siteUrl)
        .setDesc(s.siteUrlDesc)
        .addText((text) =>
          text
            .setPlaceholder(DECKS_PRO_SITE_URL)
            .setValue(this.settings.ai.proSiteUrl ?? "")
            .onChange(async (value) => {
              this.settings.ai.proSiteUrl = value.trim();
              await this.saveSettings();
            }),
        );
    }
  }

  private async renderProAccountInto(
    panel: HTMLElement,
    rerender: () => void,
  ): Promise<void> {
    const s = I18n.t.settings.ai;
    const auth = this.plugin.decksProAuth;
    const signedIn = await auth.isSignedIn();

    if (!signedIn) {
      new Setting(panel)
        .setName(s.account)
        .setDesc(s.accountSignedOut)
        .addButton((button) =>
          button
            .setButtonText(s.signIn)
            .setCta()
            .onClick(() => {
              auth.startSignIn(this.plugin.app.vault.getName());
              new Notice(s.signInPending);
            }),
        )
        .addButton((button) =>
          button
            .setButtonText(s.subscribe)
            .onClick(() => window.open(auth.pricingUrl(), "_blank")),
        );
      return;
    }

    const account = new Setting(panel).setName(s.account).setDesc(s.accountLoading);
    account.addButton((button) =>
      button.setButtonText(s.accountRefresh).onClick(() => rerender()),
    );
    account.addButton((button) =>
      button.setButtonText(s.signOut).onClick(async () => {
        await auth.signOut();
        new Notice(s.signOutDone);
        rerender();
      }),
    );

    const data = await auth.fetchAccount();
    if (!data) {
      account.setDesc(s.accountError);
      return;
    }

    account.setDesc(
      data.user.email
        ? I18n.format(s.accountSignedInAs, { email: data.user.email })
        : s.accountSignedIn,
    );

    const statusLabels: Record<string, string> = {
      active: s.subscriptionActive,
      on_trial: s.subscriptionTrial,
      past_due: s.subscriptionPastDue,
      cancelled: s.subscriptionCancelled,
      expired: s.subscriptionExpired,
      paused: s.subscriptionPaused,
    };

    // A trial user has no subscription row yet — say which state they're in
    // rather than showing a bare "no subscription".
    const subscriptionDesc = data.subscription
      ? (statusLabels[data.subscription.status] ?? data.subscription.status)
      : data.trial?.exhausted
        ? s.trialExhausted
        : data.trial?.on_trial
          ? s.trialActive
          : s.subscriptionNone;

    const subscription = new Setting(panel)
      .setName(s.subscriptionStatus)
      .setDesc(subscriptionDesc);
    if (data.subscription) {
      subscription.addButton((button) =>
        button
          .setButtonText(s.manageSubscription)
          .onClick(() =>
            window.open(
              data.subscription?.customer_portal_url ?? auth.accountUrl(),
              "_blank",
            ),
          ),
      );
    } else {
      subscription.addButton((button) =>
        button
          .setButtonText(s.subscribe)
          .setCta()
          .onClick(() => window.open(auth.pricingUrl(), "_blank")),
      );
    }
  }


  // The local (openai-compatible) provider keeps a free-text model field since
  // its ids depend on the running server; hosted providers get a curated
  // dropdown plus a "Custom…" option that reveals a free-text field.
  private renderModelSetting(
    containerEl: HTMLElement,
    provider: AiProviderId,
  ): void {
    const s = I18n.t.settings.ai;
    const current = this.settings.ai.models[provider] ?? "";

    if (provider === "openai-compatible") {
      new Setting(containerEl)
        .setName(s.model)
        .setDesc(s.modelDesc)
        .addText((text) =>
          text.setValue(current).onChange(async (value) => {
            this.settings.ai.models[provider] = value.trim();
            await this.saveSettings();
          }),
        );
      return;
    }

    const CUSTOM = "__custom__";
    const presets = PROVIDER_MODELS[provider];
    // Decks Pro exposes generation *tiers* (no raw model / custom field); the
    // dropdown is labelled "Tier".
    const isPro = provider === "decks-pro";
    const allowCustom = !isPro;
    this.settings.ai.customModel ??= {};
    const isCustom = allowCustom && (this.settings.ai.customModel[provider] ?? false);

    // Retirement: a non-custom stored id that is no longer offered (a model we
    // removed in an update) falls back to the first preset; persist so saved
    // state matches the dropdown.
    const selectedId = resolveModelId(provider, current, isCustom);
    if (selectedId !== current) {
      this.settings.ai.models[provider] = selectedId;
      this.settings.ai.customModel[provider] = false;
      void this.saveSettings();
    }

    // Decks Pro has no tier control here: the choice belongs next to the work,
    // and every AI modal already offers it. This row is left as a pointer to
    // what the tiers mean, with no duplicate control to drift out of sync.
    if (isPro) {
      const proSetting = new Setting(containerEl).setName(s.tier).setDesc(s.tierDesc);
      proSetting.descEl.createEl("br");
      proSetting.descEl.createEl("a", {
        text: "decksmd.app/docs/ai-tiers",
        href: "https://decksmd.app/docs/ai-tiers/",
      });
      return;
    }

    new Setting(containerEl)
      .setName(s.model)
      .setDesc(s.modelDesc)
      .addDropdown((dd) => {
        for (const m of presets) dd.addOption(m.id, m.name);
        if (allowCustom) dd.addOption(CUSTOM, s.modelCustom);
        dd.setValue(isCustom ? CUSTOM : selectedId);
        dd.onChange(async (value) => {
          this.settings.ai.customModel ??= {};
          if (value === CUSTOM) {
            this.settings.ai.customModel[provider] = true;
            await this.saveSettings();
            this.renderAiProviderSettings(containerEl);
            return;
          }
          this.settings.ai.customModel[provider] = false;
          this.settings.ai.models[provider] = value;
          await this.saveSettings();
          this.renderAiProviderSettings(containerEl);
        });
      });

    if (isCustom) {
      new Setting(containerEl)
        .setName(s.modelCustomLabel)
        .addText((text) =>
          text.setValue(current).onChange(async (value) => {
            this.settings.ai.models[provider] = value.trim();
            await this.saveSettings();
          }),
        );
    }
  }

  private addAppBanner(containerEl: HTMLElement): void {
    const banner = containerEl.createDiv({ cls: "decks-pro-banner decks-app-banner" });
    const text = banner.createDiv({ cls: "decks-pro-banner-text" });
    text.createDiv({ cls: "decks-pro-banner-title", text: I18n.t.mobileApp.heading });
    text.createDiv({ cls: "decks-pro-banner-body", text: I18n.t.mobileApp.body });
    const link = banner.createEl("a", {
      cls: "decks-app-banner-badge",
      attr: { href: APP_STORE_URL, "aria-label": I18n.t.mobileApp.cta },
    });
    link.createEl("img", {
      attr: { src: APP_STORE_BADGE, alt: I18n.t.mobileApp.cta, height: "40" },
    });
  }

  private addProBanner(containerEl: HTMLElement): void {
    const banner = containerEl.createDiv({ cls: "decks-pro-banner" });
    const text = banner.createDiv({ cls: "decks-pro-banner-text" });
    text.createDiv({ cls: "decks-pro-banner-title", text: I18n.t.pro.heading });
    text.createDiv({ cls: "decks-pro-banner-body", text: I18n.t.pro.body });
    banner.createEl("a", {
      cls: "decks-pro-banner-cta",
      text: I18n.t.pro.cta,
      attr: { href: `${DECKS_PRO_SITE_URL}/pricing/` },
    });
  }

  private addLanguageSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.language.heading).setHeading();

    new Setting(containerEl)
      .setName(I18n.t.settings.language.name)
      .setDesc(I18n.t.settings.language.desc)
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", I18n.t.settings.language.auto);
        for (const lang of SUPPORTED_LANGUAGES) {
          dropdown.addOption(lang.code, lang.label);
        }
        dropdown
          .setValue(this.settings.i18n?.language ?? "auto")
          .onChange(async (value) => {
            this.settings.i18n = { language: value as LanguagePreference };
            await this.saveSettings();
            // Re-resolve language and re-render this settings tab immediately,
            // so the user sees the change confirmed in the new language.
            // Other already-mounted views (deck list, review modal, commands)
            // still need a plugin reload to pick it up.
            I18n.init(this.settings, getLanguage());
            new Notice(I18n.t.notices.languageChanged);
            this.display();
          });
      });
  }

  private addPathsSettings(containerEl: HTMLElement): void {
    const configDir = this.plugin.app.vault.configDir;
    const pluginFolder = `${configDir}/plugins/${this.plugin.manifest.id}`;

    new Setting(containerEl).setName(I18n.t.settings.paths.heading).setHeading();
    containerEl.createEl("p", {
      text: I18n.format(I18n.t.settings.paths.paragraph, { configDir }),
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.paths.dbFolder)
      .setDesc(I18n.format(I18n.t.settings.paths.dbFolderDesc, { pluginFolder }))
      .addText((text) =>
        text
          .setPlaceholder(pluginFolder)
          .setValue(this.settings.paths.dbFolder)
          .onChange(async (value) => {
            this.settings.paths.dbFolder = value.trim();
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.paths.backupFolder)
      .setDesc(I18n.format(I18n.t.settings.paths.backupFolderDesc, { pluginFolder }))
      .addText((text) =>
        text
          .setPlaceholder(
            I18n.format(I18n.t.settings.paths.backupFolderPlaceholder, { pluginFolder })
          )
          .setValue(this.settings.paths.backupFolder)
          .onChange(async (value) => {
            this.settings.paths.backupFolder = value.trim();
            await this.saveSettings();
            // BackupService reads the folder on demand; nudge it now so
            // "available backups" picks up the new location immediately.
            const newFolder = this.settings.paths.backupFolder.trim();
            this.plugin.refreshBackupFolder?.(newFolder);
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.paths.syncLogFolder)
      .setDesc(I18n.t.settings.paths.syncLogFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.paths.syncLogFolderPlaceholder)
          .setValue(this.settings.paths.syncLogFolder)
          .onChange(async (value) => {
            this.settings.paths.syncLogFolder = value.trim();
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.paths.pdfCacheFolder)
      .setDesc(I18n.format(I18n.t.settings.paths.pdfCacheFolderDesc, { pluginFolder }))
      .addText((text) =>
        text
          .setPlaceholder(
            I18n.format(I18n.t.settings.paths.pdfCacheFolderPlaceholder, {
              pluginFolder,
            })
          )
          .setValue(this.settings.paths.pdfCacheFolder)
          .onChange(async (value) => {
            this.settings.paths.pdfCacheFolder = value.trim();
            await this.saveSettings();
          })
      );
  }

  private async addFsrsOptimizationSettings(containerEl: HTMLElement): Promise<void> {
    new Setting(containerEl)
      .setName(I18n.t.settings.fsrs.heading)
      .setHeading()
      .addExtraButton((b) =>
        b
          .setIcon("info")
          .setTooltip(I18n.t.help.docs)
          .onClick(() => window.open(docUrl("reviewing/optimizer"), "_blank"))
      );

    const active = await this.db.getActiveTrainedWeightSet();
    const desc = this.formatFsrsDescription(active);

    const setting = new Setting(containerEl)
      .setName(I18n.t.settings.fsrs.optimize)
      .setDesc(desc);

    setting.addButton((b) =>
      b
        .setButtonText(I18n.t.settings.fsrs.optimizeButton)
        .setCta()
        .onClick(() => {
          new OptimizeFsrsModal(this.app, this.db, this.logger, () =>
            this.display()
          ).open();
        })
    );

    if (active) {
      setting.addButton((b) =>
        b
          .setButtonText(I18n.t.settings.fsrs.resetButton)
          .setWarning()
          .onClick(async () => {
            await this.db.clearTrainedWeights();
            new Notice(I18n.t.notices.trainedParamsCleared);
            this.display();
          })
      );
    }
  }

  private formatFsrsDescription(active: FsrsWeightSet | null): string {
    if (!active) {
      return I18n.t.settings.fsrs.descUntrained;
    }
    const when = active.trainedAt
      ? new Date(active.trainedAt).toLocaleString()
      : I18n.t.settings.fsrs.descTrainedUnknownWhen;
    const before =
      active.beforeLogLoss?.toFixed(4) ?? I18n.t.settings.fsrs.descTrainedMissingMetric;
    const after =
      active.afterLogLoss?.toFixed(4) ?? I18n.t.settings.fsrs.descTrainedMissingMetric;
    return I18n.format(I18n.t.settings.fsrs.descTrained, {
      when,
      count: active.reviewsTrained.toLocaleString(),
      before,
      after,
    });
  }

  // Five capturable review keys (four ratings + reveal/advance).
  // Standalone "Keyboard shortcuts" section: the master toggle plus the nested,
  // customizable review keys (shown only while enabled).
  private addKeyboardShortcutSettings(containerEl: HTMLElement): void {
    const s = I18n.t.settings.review;
    new Setting(containerEl).setName(s.keyboardShortcuts).setHeading();

    new Setting(containerEl)
      .setName(s.enableShortcuts)
      .setDesc(s.keyboardShortcutsDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.enableKeyboardShortcuts)
          .onChange(async (value) => {
            this.settings.review.enableKeyboardShortcuts = value;
            await this.saveSettings();
            this.renderReviewShortcutRows(shortcutsEl);
          })
      );

    const shortcutsEl = containerEl.createDiv({ cls: "decks-nested-settings" });
    this.renderReviewShortcutRows(shortcutsEl);
  }

  // Renders the customizable review keys into the (indented) sub-container.
  // Hidden when keyboard shortcuts are disabled.
  private renderReviewShortcutRows(containerEl: HTMLElement): void {
    this.cancelShortcutCapture?.();
    containerEl.empty();
    if (!this.settings.review.enableKeyboardShortcuts) return;

    const s = I18n.t.settings.review;
    const rl = I18n.t.review; // reuse the already-translated rating labels
    const actions: Array<{ key: keyof ReviewShortcuts; name: string }> = [
      { key: "again", name: rl.again },
      { key: "hard", name: rl.hard },
      { key: "good", name: rl.good },
      { key: "easy", name: rl.easy },
      { key: "reveal", name: s.shortcutReveal },
    ];
    const buttons = new Map<keyof ReviewShortcuts, ButtonComponent>();
    const refresh = (): void => {
      for (const { key } of actions) {
        buttons
          .get(key)
          ?.setButtonText(displayShortcutKey(this.settings.review.shortcuts[key]));
      }
    };

    new Setting(containerEl)
      .setName(s.shortcutsHeading)
      .setDesc(s.shortcutsHeadingDesc);

    for (const { key, name } of actions) {
      new Setting(containerEl).setName(name).addButton((btn) => {
        buttons.set(key, btn);
        btn
          .setButtonText(displayShortcutKey(this.settings.review.shortcuts[key]))
          .onClick(() => this.captureShortcut(key, btn, refresh));
      });
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText(s.shortcutResetDefaults).onClick(async () => {
        this.cancelShortcutCapture?.();
        this.settings.review.shortcuts = { ...DEFAULT_REVIEW_SHORTCUTS };
        await this.saveSettings();
        refresh();
      })
    );
  }

  private captureShortcut(
    action: keyof ReviewShortcuts,
    btn: ButtonComponent,
    refresh: () => void
  ): void {
    const s = I18n.t.settings.review;
    // Only one capture at a time.
    this.cancelShortcutCapture?.();
    btn.setButtonText(s.shortcutPressKey);

    const onKey = (evt: KeyboardEvent): void => {
      // Ignore a bare modifier press — wait for the real key.
      if (["Shift", "Control", "Alt", "Meta"].includes(evt.key)) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.cancelShortcutCapture?.();
      if (evt.key === "Escape") return; // cancel, keep current binding

      const nextKey = normalizeShortcutKey(evt.key);
      const shortcuts = this.settings.review.shortcuts;
      const clashes = (
        Object.keys(shortcuts) as Array<keyof ReviewShortcuts>
      ).some((k) => k !== action && matchesShortcut(shortcuts[k], nextKey));
      if (clashes) {
        new Notice(s.shortcutDuplicate);
        return;
      }
      shortcuts[action] = nextKey;
      void this.saveSettings().then(refresh);
    };

    activeDocument.addEventListener("keydown", onKey, true);
    this.cancelShortcutCapture = (): void => {
      activeDocument.removeEventListener("keydown", onKey, true);
      this.cancelShortcutCapture = undefined;
      refresh();
    };
  }

  private addReviewSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(I18n.t.settings.review.heading)
      .setHeading()
      .addExtraButton((b) =>
        b
          .setIcon("info")
          .setTooltip(I18n.t.help.docs)
          .onClick(() => window.open(docUrl("organizing/settings"), "_blank"))
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.review.showProgress)
      .setDesc(I18n.t.settings.review.showProgressDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.showProgress)
          .onChange(async (value) => {
            this.settings.review.showProgress = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.review.sessionDuration)
      .setDesc(I18n.t.settings.review.sessionDurationDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.review.sessionDurationPlaceholder)
          .setValue(this.settings.review.sessionDuration.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 60) {
              this.settings.review.sessionDuration = num;
              await this.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.review.studyDayStartsAt)
      .setDesc(I18n.t.settings.review.studyDayStartsAtDesc)
      .addSlider((slider) =>
        slider
          .setLimits(0, 23, 1)
          .setValue(this.settings.review.nextDayStartsAt)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.review.nextDayStartsAt = value;
            await this.saveSettings();
          })
      );

    // Global daily review cap across all decks (dependent amount + toggle).
    const globalReviewCapSetting = new Setting(containerEl)
      .setName(I18n.t.settings.review.globalReviewCap)
      .setDesc(I18n.t.settings.review.globalReviewCapDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.review.globalReviewCapPlaceholder)
          .setValue(this.settings.review.globalReviewCapAmount.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 99999) {
              this.settings.review.globalReviewCapAmount = num;
              await this.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.review.enableGlobalReviewCap)
      .setDesc(I18n.t.settings.review.enableGlobalReviewCapDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.review.hasGlobalReviewCap)
          .onChange(async (value) => {
            this.settings.review.hasGlobalReviewCap = value;
            await this.saveSettings();
            globalReviewCapSetting.setDisabled(!value);
          })
      );
    globalReviewCapSetting.setDisabled(!this.settings.review.hasGlobalReviewCap);

    new Setting(containerEl)
      .setName(I18n.t.settings.review.leechThreshold)
      .setDesc(I18n.t.settings.review.leechThresholdDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.review.leechThresholdPlaceholder)
          .setValue(this.settings.review.leechThreshold.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 100) {
              this.settings.review.leechThreshold = num;
              await this.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.review.denseCardCharThreshold)
      .setDesc(I18n.t.settings.review.denseCardCharThresholdDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.review.denseCardCharThresholdPlaceholder)
          .setValue(this.settings.review.denseCardCharThreshold.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 50 && num <= 5000) {
              this.settings.review.denseCardCharThreshold = num;
              await this.saveSettings();
            }
          })
      );
  }

  private isValidDeckTag(tag: string): boolean {
    return /^#[a-z0-9][a-z0-9_-]*$/.test(tag);
  }

  private async migrateTagMappings(oldTag: string, newTag: string): Promise<void> {
    const mappings = await this.db.getAllTagMappings();
    for (const mapping of mappings) {
      if (mapping.tag === oldTag || mapping.tag.startsWith(oldTag + "/")) {
        const migratedTag = newTag + mapping.tag.slice(oldTag.length);
        await this.db.deleteTagMapping(mapping.id);
        await this.db.createTagMapping(mapping.profileId, migratedTag);
      }
    }
    await this.db.save();
  }

  private addParsingSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.parsing.heading).setHeading();

    let previousTag = this.settings.parsing.deckTag;

    new Setting(containerEl)
      .setName(I18n.t.settings.parsing.deckTag)
      .setDesc(
        I18n.format(I18n.t.settings.parsing.deckTagDesc, {
          tag: this.settings.parsing.deckTag,
        })
      )
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.parsing.deckTagPlaceholder)
          .setValue(this.settings.parsing.deckTag)
          .onChange(async (value) => {
            const trimmed = value.trim().toLowerCase();
            if (this.isValidDeckTag(trimmed) && trimmed !== previousTag) {
              const oldTag = previousTag;
              this.settings.parsing.deckTag = trimmed;
              previousTag = trimmed;
              await this.saveSettings();
              await this.migrateTagMappings(oldTag, trimmed);
            }
          })
      );

    // Get all folders for dropdown options
    const folderOptions: Record<string, string> = {
      "": I18n.t.settings.parsing.folderSearchPathDefault,
    };

    this.app.vault.getAllFolders().forEach((folder) => {
      folderOptions[folder.path] = folder.path;
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.parsing.folderSearchPath)
      .setDesc(I18n.t.settings.parsing.folderSearchPathDesc)
      .addDropdown((dropdown) => {
        // Add options to dropdown
        Object.entries(folderOptions).forEach(([value, display]) => {
          dropdown.addOption(value, display);
        });

        dropdown
          .setValue(normalizePath(this.settings.parsing.folderSearchPath))
          .onChange(async (value) => {
            this.settings.parsing.folderSearchPath = normalizePath(value);
            await this.saveSettings();
          });
      });
  }

  private isValidCanvasTag(tag: string): boolean {
    return /^#[a-z0-9][a-z0-9_/-]*$/.test(tag);
  }

  private addCanvasDecksSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(I18n.t.settings.canvasDecks.heading)
      .setHeading()
      .addExtraButton((b) =>
        b
          .setIcon("info")
          .setTooltip(I18n.t.help.docs)
          .onClick(() => window.open(docUrl("cards/canvas"), "_blank"))
      );

    // Folder picker dropdown reusing the same getAllFolders() pattern.
    const folderOptions: Record<string, string> = {
      "": I18n.t.settings.canvasDecks.folderPathDefault,
    };
    this.app.vault.getAllFolders().forEach((folder) => {
      folderOptions[folder.path] = folder.path;
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.canvasDecks.folderPath)
      .setDesc(I18n.t.settings.canvasDecks.folderPathDesc)
      .addDropdown((dropdown) => {
        Object.entries(folderOptions).forEach(([value, display]) => {
          dropdown.addOption(value, display);
        });
        dropdown
          .setValue(normalizePath(this.settings.canvasDecks.folderPath))
          .onChange(async (value) => {
            this.settings.canvasDecks.folderPath = normalizePath(value);
            await this.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(I18n.t.settings.canvasDecks.tagName)
      .setDesc(I18n.t.settings.canvasDecks.tagNameDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.canvasDecks.tagNamePlaceholder)
          .setValue(this.settings.canvasDecks.tagName)
          .onChange(async (value) => {
            const trimmed = value.trim().toLowerCase();
            if (this.isValidCanvasTag(trimmed)) {
              this.settings.canvasDecks.tagName = trimmed;
              await this.saveSettings();
            }
          })
      );
  }

  private addUISettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.ui.heading).setHeading();

    const intervalSetting = new Setting(containerEl)
      .setName(I18n.t.settings.ui.backgroundRefreshInterval)
      .setDesc(I18n.t.settings.ui.backgroundRefreshIntervalDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.ui.backgroundRefreshIntervalPlaceholder)
          .setValue(this.settings.ui.backgroundRefreshInterval.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1 && num <= 60) {
              this.settings.ui.backgroundRefreshInterval = num;
              await this.saveSettings();
              // Restart background refresh with new interval
              this.restartBackgroundRefresh();
            }
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.enableBackgroundRefresh)
      .setDesc(I18n.t.settings.ui.enableBackgroundRefreshDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.ui.enableBackgroundRefresh)
          .onChange(async (value) => {
            this.settings.ui.enableBackgroundRefresh = value;
            await this.saveSettings();

            // Enable/disable interval setting based on toggle
            intervalSetting.setDisabled(!value);

            // Start or stop background refresh based on setting
            if (value) {
              this.startBackgroundRefresh();
            } else {
              this.stopBackgroundRefresh();
            }
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.enableNotices)
      .setDesc(I18n.t.settings.ui.enableNoticesDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.ui.enableNotices)
          .onChange(async (value) => {
            this.settings.ui.enableNotices = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.hideAnchorTokens)
      .setDesc(I18n.t.settings.ui.hideAnchorTokensDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.ui.hideAnchorTokensInEditor)
          .onChange(async (value) => {
            this.settings.ui.hideAnchorTokensInEditor = value;
            await this.saveSettings();
            this.plugin.applyEditorExtensions();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.reviewDisplayMode)
      .setDesc(I18n.t.settings.ui.reviewDisplayModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", I18n.t.settings.ui.displayModeModal)
          .addOption("tab", I18n.t.settings.ui.displayModeTab)
          .setValue(this.settings.ui.reviewDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.reviewDisplayMode = value as "modal" | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.flashcardManagerDisplayMode)
      .setDesc(I18n.t.settings.ui.flashcardManagerDisplayModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", I18n.t.settings.ui.displayModeModal)
          .addOption("tab", I18n.t.settings.ui.displayModeTab)
          .setValue(this.settings.ui.flashcardManagerDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.flashcardManagerDisplayMode = value as
              | "modal"
              | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.aiGeneratorDisplayMode)
      .setDesc(I18n.t.settings.ui.aiGeneratorDisplayModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modal", I18n.t.settings.ui.displayModeModal)
          .addOption("tab", I18n.t.settings.ui.displayModeTab)
          .setValue(this.settings.ui.aiGeneratorDisplayMode)
          .onChange(async (value) => {
            this.settings.ui.aiGeneratorDisplayMode = value as "modal" | "tab";
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.ui.minDeckCardCount)
      .setDesc(I18n.t.settings.ui.minDeckCardCountDesc)
      .addText((text) =>
        text
          .setPlaceholder(I18n.t.settings.ui.minDeckCardCountPlaceholder)
          .setValue(String(this.settings.ui.minDeckCardCount))
          .onChange(async (value) => {
            const n = Number.parseInt(value, 10);
            const next = Number.isFinite(n) && n >= 0 ? n : 0;
            this.settings.ui.minDeckCardCount = next;
            await this.saveSettings();
            // Push the new threshold into the sidepanel if it's mounted
            // so the user sees the filter apply without reopening.
            this.plugin.getDecksView()?.applyMinDeckCardCountUpdate(next);
          })
      );

    // Set initial state of interval setting
    intervalSetting.setDisabled(!this.settings.ui.enableBackgroundRefresh);
  }

  private addDebugSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.debug.heading).setHeading();
    containerEl.createEl("p", {
      text: I18n.t.settings.debug.paragraph,
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.debug.enableLogging)
      .setDesc(I18n.t.settings.debug.enableLoggingDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.debug?.enableLogging || false)
          .onChange(async (value) => {
            if (!this.settings.debug) {
              this.settings.debug = {
                enableLogging: false,
                performanceLogs: false,
              };
            }
            this.settings.debug.enableLogging = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.debug.performanceLogs)
      .setDesc(I18n.t.settings.debug.performanceLogsDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.debug?.performanceLogs || false)
          .onChange(async (value) => {
            if (!this.settings.debug) {
              this.settings.debug = {
                enableLogging: false,
                performanceLogs: false,
              };
            }
            this.settings.debug.performanceLogs = value;
            await this.saveSettings();
          })
      );
  }

  private addDatabaseSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.database.heading).setHeading();
    containerEl.createEl("p", {
      text: I18n.t.settings.database.paragraph,
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(I18n.t.settings.database.purgeDatabase)
      .setDesc(I18n.t.settings.database.purgeDatabaseDesc)
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.database.purgeDatabaseButton)
          .setWarning()
          .onClick(() => {
            new DatabasePurgeModal(
              this.app,
              this.purgeDatabase,
              this.performSync,
              this.refreshViewStats,
              this.logger
            ).open();
          })
      );
  }

  private addBackupSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(I18n.t.settings.backup.heading).setHeading();

    new Setting(containerEl)
      .setName(I18n.t.settings.backup.enableAutoBackup)
      .setDesc(I18n.t.settings.backup.enableAutoBackupDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.settings.backup.enableAutoBackup)
          .onChange(async (value) => {
            this.settings.backup.enableAutoBackup = value;
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.backup.maxBackups)
      .setDesc(I18n.t.settings.backup.maxBackupsDesc)
      .addSlider((slider) =>
        slider
          .setLimits(3, 10, 1)
          .setValue(this.settings.backup.maxBackups)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.settings.backup.maxBackups = value;
            this.backupService.setMaxBackups(value);
            await this.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.backup.createBackupNow)
      .setDesc(I18n.t.settings.backup.createBackupNowDesc)
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.createBackupButton)
          .setCta()
          .onClick(async () => {
            const notice = new Notice(I18n.t.notices.creatingBackup, 0);
            try {
              const filename = await this.backupService.createBackup(this.db);
              notice.hide();
              new Notice(I18n.format(I18n.t.notices.backupCreated, { filename }), 5000);
            } catch (error) {
              notice.hide();
              new Notice(
                I18n.format(I18n.t.notices.backupFailed, {
                  message: (error as Error).message,
                }),
                8000
              );
              this.logger.debug("Backup creation failed:", error);
            }
          })
      );

    // Backup restoration section
    new Setting(containerEl).setName(I18n.t.settings.backup.restoreHeading).setHeading();

    let selectedBackup = "";
    const backupSetting = new Setting(containerEl)
      .setClass("decks-backup-restore-setting")
      .setName(I18n.t.settings.backup.availableBackups)
      .setDesc(I18n.t.settings.backup.availableBackupsDesc)
      .addDropdown((dropdown) => {
        dropdown.addOption("", I18n.t.settings.backup.selectBackupOption);
        dropdown.onChange((value) => {
          selectedBackup = value;
        });
      })
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.refreshButton)
          .setTooltip(I18n.t.settings.backup.refreshTooltip)
          .onClick(async () => {
            await this.refreshBackupList(backupSetting);
          })
      )
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.restoreButton)
          .setCta()
          .onClick(async () => {
            if (!selectedBackup) {
              new Notice(I18n.t.notices.selectBackupPrompt);
              return;
            }

            await this.restoreBackup(selectedBackup);
          })
      )
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.restoreFromFile)
          .setTooltip(I18n.t.settings.backup.restoreFromFileTooltip)
          .onClick(() => {
            this.pickAndRestoreFromFile();
          })
      );

    new Setting(containerEl)
      .setName(I18n.t.settings.backup.rebuildState)
      .setDesc(I18n.t.settings.backup.rebuildStateDesc)
      .addButton((button) =>
        button
          .setButtonText(I18n.t.settings.backup.rebuildStateButton)
          .onClick(async () => {
            await this.rebuildCardStateFromReviewLogs();
          })
      );

    // Initial load of backup list
    this.refreshBackupList(backupSetting).catch((error) => {
      this.logger.debug("Failed to load initial backup list:", error);
    });
  }

  /**
   * Recovery action: rebuild card scheduling state from review history for cards
   * that show as new but have logs. Takes a safety backup first.
   */
  private async rebuildCardStateFromReviewLogs(): Promise<void> {
    const notice = new Notice(I18n.t.notices.creatingBackup, 0);
    try {
      await this.backupService.createBackup(this.db);
      const count = await this.db.rebuildCardStateFromReviewLogs();
      await this.db.save();
      notice.hide();
      new Notice(I18n.format(I18n.t.notices.cardsRebuilt, { count }), 6000);
    } catch (error) {
      notice.hide();
      new Notice(
        I18n.format(I18n.t.notices.restoreFailed, {
          message: (error as Error).message,
        }),
        8000
      );
      this.logger.debug("Rebuild from review history failed:", error);
    }
  }

  /**
   * Open a native file picker for a .db file anywhere on disk, then restore
   * the database from its raw bytes. Uses HTML <input type="file"> rather
   * than Electron's remote.dialog so the same code works on iOS/Android
   * Obsidian (the WebView's native picker is available everywhere). The
   * raw bytes are validated against the SQLite header + schema version
   * before being applied.
   */
  private pickAndRestoreFromFile(): void {
    const input = activeDocument.createElement("input");
    input.type = "file";
    input.accept = ".db,application/octet-stream";
    // Hidden from the activeDocument — we only need it as a programmatic file
    // picker trigger. The setCssProps helper avoids ESLint's no-inline-
    // style rule while keeping the element invisible.
    input.setCssProps({ display: "none" });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      this.restoreFromFileBytes(file).catch((error: Error) => {
        this.logger.debug("Restore from file failed", error);
        new Notice(
          I18n.format(I18n.t.notices.restoreFailed, { message: error.message }),
          8000
        );
      });
    });
    activeDocument.body.appendChild(input);
    input.click();
    // Detach after the picker fires; some browsers leak the element otherwise.
    window.setTimeout(() => input.remove(), 60_000);
  }

  private async restoreFromFileBytes(file: File): Promise<void> {
    if (!this.db) throw new Error("Database not available");
    const progressNotice = new Notice(
      I18n.format(I18n.t.notices.restoringFromFile, { filename: file.name }),
      0
    );
    try {
      const buffer = await file.arrayBuffer();
      await this.backupService.restoreFromFile(
        buffer,
        this.db,
        (current, total) => {
          const progress = Math.round((current / total) * 100);
          progressNotice.setMessage(
            I18n.format(I18n.t.notices.restoringFromFileProgress, {
              filename: file.name,
              progress,
            })
          );
        }
      );
      progressNotice.hide();
      const decksView = this.plugin.getDecksView();
      if (decksView) {
        await decksView.refresh({ skipSync: true });
      }
    } catch (error) {
      progressNotice.hide();
      throw error;
    }
  }

  private async refreshBackupList(setting: Setting): Promise<void> {
    try {
      this.logger.debug("Refreshing backup list...");
      const backups = await this.backupService.getAvailableBackups();
      this.logger.debug("Found backups:", backups);

      // Get the dropdown component
      const dropdown = setting.components.find(
        (comp) => comp instanceof DropdownComponent
      );

      if (dropdown === undefined) {
        this.logger.debug("Dropdown component not found");
        new Notice(I18n.t.notices.dropdownNotFound, 3000);
        return;
      }

      // Clear existing options by removing all children
      while (dropdown.selectEl.firstChild) {
        dropdown.selectEl.removeChild(dropdown.selectEl.firstChild);
      }

      // Add default option
      const defaultOption = dropdown.selectEl.createEl("option");
      defaultOption.value = "";
      defaultOption.textContent = I18n.t.settings.backup.selectBackupOption;

      if (backups.length === 0) {
        const noBackupsOption = dropdown.selectEl.createEl("option");
        noBackupsOption.value = "";
        noBackupsOption.textContent = I18n.t.settings.backup.noBackupsOption;
        dropdown.setDisabled(true);
        new Notice(I18n.t.notices.noBackupsFound, 3000);
      } else {
        dropdown.setDisabled(false);
        for (const backup of backups) {
          const option = dropdown.selectEl.createEl("option");
          option.value = backup.filename;
          option.textContent = `${backup.timestamp.toLocaleString()}`;
        }
        new Notice(
          I18n.format(I18n.t.notices.backupsFound, { count: backups.length }),
          3000
        );
      }
    } catch (error) {
      this.logger.debug("Failed to load backup list:", error);
      new Notice(
        I18n.format(I18n.t.notices.backupListFailed, {
          message: (error as Error).message,
        }),
        5000
      );
    }
  }

  private async restoreBackup(filename: string): Promise<void> {
    const progressNotice = new Notice(I18n.t.notices.restoringBackup, 0);

    try {
      // Get database service from plugin
      if (!this.db) {
        throw new Error("Database not available");
      }

      let current = 0;
      let total = 0;

      await this.backupService.restoreFromBackup(
        filename,
        this.db,
        (currentCount: number, totalCount: number) => {
          current = currentCount;
          total = totalCount;
          const progress = Math.round((current / total) * 100);
          progressNotice.setMessage(
            I18n.format(I18n.t.notices.restoreProgress, {
              progress,
              current,
              total,
            })
          );
        }
      );

      progressNotice.hide();

      const decksView = this.plugin.getDecksView();
      if (decksView) {
        await decksView.refresh({ skipSync: true });
      }
    } catch (error) {
      progressNotice.hide();
      this.logger.debug("Backup restoration failed:", error);
      new Notice(
        I18n.format(I18n.t.notices.backupRestoreFailed, {
          message: (error as Error).message,
        }),
        8000
      );
    }
  }
}

class DatabasePurgeModal extends Modal {
  private purgeDatabase: () => Promise<void>;
  private performSync: (force?: boolean) => Promise<void>;
  private refreshViewStats: () => Promise<void>;
  private logger: Logger;

  constructor(
    app: App,
    purgeDatabase: () => Promise<void>,
    performSync: (force?: boolean) => Promise<void>,
    refreshViewStats: () => Promise<void>,
    logger: Logger
  ) {
    super(app);
    this.purgeDatabase = purgeDatabase;
    this.performSync = performSync;
    this.refreshViewStats = refreshViewStats;
    this.logger = logger;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: I18n.t.modals.purgeDatabase.title });

    const warning = contentEl.createEl("div", {
      cls: "setting-item-description",
    });

    const p1 = warning.createEl("p");
    p1.createEl("strong", {
      text: I18n.t.modals.purgeDatabase.warningStrong,
    });

    const ul = warning.createEl("ul");
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listFlashcards });
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listReviews });
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listDecks });
    ul.createEl("li", { text: I18n.t.modals.purgeDatabase.listStatistics });

    const p2 = warning.createEl("p");
    p2.createEl("strong", { text: I18n.t.modals.purgeDatabase.cannotUndo });

    warning.createEl("p", {
      text: I18n.t.modals.purgeDatabase.rebuildNote,
    });

    contentEl.createEl("p", {
      text: I18n.t.modals.purgeDatabase.confirmPrompt,
      cls: "setting-item-description",
    });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: I18n.t.modals.purgeDatabase.confirmPlaceholder,
      cls: "decks-dialog-width decks-dialog-margin-bottom",
    });

    const buttonContainer = contentEl.createEl("div", {
      cls: "decks-flex-container decks-flex-gap decks-flex-justify-end",
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: I18n.t.modals.purgeDatabase.cancel,
    });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonContainer.createEl("button", {
      text: I18n.t.modals.purgeDatabase.purgeButton,
      cls: "mod-warning",
    });

    confirmButton.onclick = async () => {
      if (input.value === I18n.t.modals.purgeDatabase.confirmPlaceholder) {
        try {
          this.close();

          // Show progress notice
          const notice = new Notice(I18n.t.notices.purgingDatabase, 0);

          // Purge the database
          await this.purgeDatabase();

          // Trigger a full sync to rebuild from vault
          await this.performSync(true);

          // Update the notice
          notice.setMessage(I18n.t.notices.databasePurged);
          window.setTimeout(() => notice.hide(), 3000);

          // Refresh the view
          await this.refreshViewStats();
        } catch (error) {
          this.logger.debug("Failed to purge database:", error);
          new Notice(I18n.t.notices.purgeFailed, 5000);
        }
      } else {
        new Notice(I18n.t.notices.purgeConfirmMismatch, 3000);
      }
    };

    // Focus the input
    input.focus();

    // Allow Enter key to confirm
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        confirmButton.click();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
