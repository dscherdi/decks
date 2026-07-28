<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Setting, Notice, setIcon } from "obsidian";
  import type { Deck, DeckProfile, ProfileTagMapping, ClozeShowContext } from "../../database/types";
  import type { IDatabaseService } from "../../database/DatabaseFactory";
  import type { ReviewOrder, FSRSProfile } from "../../database/types";
  import type {
    ExamFeedbackTiming,
    ExamOptionLabels,
    ExamSelectionMode,
    ExamSettings,
    TypedGradingMode,
  } from "../../database/types";
  import { DEFAULT_PROFILE_ID, getDefaultLearningSteps, getDefaultRelearningSteps, DEFAULT_EXAM_SETTINGS, I18n, validateLearningSteps, validateRelearningSteps } from "@decks/core";
  import { ttsService } from "../../services/TtsService";
  import DocInfoButton from "../DocInfoButton.svelte";

  const t = I18n.t;
  const p = t.profiles;

  export let db: IDatabaseService;
  export let initialProfiles: DeckProfile[];
  export let onclose: () => void;
  export let trainedWeightsAvailable = false;
  export let initialTab: "settings" | "assignments" = "settings";
  export let initialProfileId: string | undefined = undefined;
  export let allDecks: Deck[] = [];

  let profiles: DeckProfile[] = initialProfiles;
  let selectedProfileId = "";
  let selectedProfile: DeckProfile | null = null;
  let tagMappings: ProfileTagMapping[] = [];
  let deckCount = 0;

  let activeTab: "settings" | "assignments" = initialTab;
  let addTag = "";
  // Per-tag "N decks · M cards" for the Assignments list, keyed by tag.
  let assignmentCounts: Record<string, { decks: number; cards: number }> = {};

  let profileNameContainer: HTMLElement;
  let newCardsLimitContainer: HTMLElement;
  let enableNewCardsContainer: HTMLElement;
  let reviewCardsLimitContainer: HTMLElement;
  let enableReviewCardsContainer: HTMLElement;
  let reviewOrderContainer: HTMLElement;
  let headerLevelContainer: HTMLElement;
  let extraHeaderLevelsContainer: HTMLElement;
  let requestRetentionContainer: HTMLElement;
  let fsrsProfileContainer: HTMLElement;
  let learningStepsContainer: HTMLElement;
  let relearningStepsContainer: HTMLElement;
  let clozeEnabledContainer: HTMLElement;
  let clozeShowContextContainer: HTMLElement;
  let ttsVoiceContainer: HTMLElement;
  let ttsRateContainer: HTMLElement;
  let examEnabledContainer: HTMLElement;
  let examSettingsContainer: HTMLElement;

  let saving = false;

  // Form fields
  let profileName = "";
  let newCardsLimit = 20;
  let reviewCardsLimit = 100;
  let enableNewCardsLimit = false;
  let enableReviewCardsLimit = false;
  let reviewOrder: ReviewOrder = "due-date";
  let headerLevel = 2;
  let extraHeaderLevels: number[] = [];
  let requestRetention = 0.9;
  let fsrsProfile: FSRSProfile = "STANDARD";
  let learningSteps = "1m";
  let relearningSteps = "10m";
  let clozeEnabled = false;
  let clozeShowContext: ClozeShowContext = "open";
  // Read-aloud voice: ttsLang is derived from the chosen voice so cross-device
  // sync can fall back to a same-language voice when the exact one is missing.
  let ttsVoice = "";
  let ttsRate = 1;
  let ttsLang = "";
  let examEnabled = false;
  let examSettings: ExamSettings = { ...DEFAULT_EXAM_SETTINGS };

  // Validation error tracking
  let nameError = false;
  let newCardsError = false;
  let reviewCardsError = false;
  let retentionError = false;
  let learningStepsError = false;
  let relearningStepsError = false;

  $: hasErrors = nameError || newCardsError || reviewCardsError || retentionError || learningStepsError || relearningStepsError;

  // Tags assignable to this profile: every deck tag and its parent levels, minus
  // the ones already mapped to this profile.
  $: mappedTagSet = new Set(tagMappings.map((m) => m.tag));
  $: assignableTags = deriveAssignableTags(allDecks, mappedTagSet);
  $: recapRows = selectedProfile ? buildRecapRows(selectedProfile, deckCount) : [];

  // Small setIcon action for icon-only buttons.
  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(next: string) {
        node.empty();
        setIcon(node, next);
      },
    };
  }

  function deriveAssignableTags(decks: Deck[], mapped: Set<string>): string[] {
    const tags = new Set<string>();
    for (const deck of decks) {
      if (!deck.tag) continue;
      const parts = deck.tag.split("/");
      for (let i = 1; i <= parts.length; i++) {
        tags.add(parts.slice(0, i).join("/"));
      }
    }
    return Array.from(tags)
      .filter((tag) => !mapped.has(tag))
      .sort();
  }

  function headerLevelDesc(profile: DeckProfile): string {
    if (profile.headerLevel === 0) return t.config.headerTitle;
    const primary = I18n.format(t.config.headerH, { level: profile.headerLevel });
    const extras = (profile.extraHeaderLevels ?? [])
      .filter((l) => l !== profile.headerLevel)
      .sort((a, b) => a - b)
      .map((l) => I18n.format(t.config.headerH, { level: l }));
    return extras.length > 0 ? `${primary} (+ ${extras.join(", ")})` : primary;
  }

  function buildRecapRows(profile: DeckProfile, decks: number): { label: string; value: string }[] {
    const rows: { label: string; value: string }[] = [];
    rows.push({
      label: t.config.newCardsLimitLabel,
      value: profile.hasNewCardsLimitEnabled
        ? I18n.format(t.config.perDay, { count: profile.newCardsPerDay })
        : t.config.unlimited,
    });
    rows.push({
      label: t.config.reviewCardsLimitLabel,
      value: profile.hasReviewCardsLimitEnabled
        ? I18n.format(t.config.perDay, { count: profile.reviewCardsPerDay })
        : t.config.unlimited,
    });
    rows.push({ label: t.config.headerLevelLabel, value: headerLevelDesc(profile) });
    rows.push({
      label: t.config.reviewOrderLabel,
      value: profile.reviewOrder === "due-date" ? t.config.reviewOrderOldestDue : t.config.reviewOrderRandomLabel,
    });
    rows.push({
      label: t.config.clozeDeletions,
      value: profile.clozeEnabled
        ? I18n.format(t.config.clozeEnabled, {
            mode: profile.clozeShowContext === "open" ? t.config.clozeShowOthers : t.config.clozeHideAll,
          })
        : t.config.clozeDisabled,
    });
    if (profile.examEnabled) {
      rows.push({ label: t.exam.examEnabledSetting, value: t.exam.examEnabledDesc });
    }
    rows.push({
      label: t.config.fsrsSettings,
      value: I18n.format(t.config.fsrsSettingsDesc, {
        retention: profile.fsrs.requestRetention,
        profile: profile.fsrs.profile,
      }),
    });
    rows.push({ label: p.decksUsingProfile, value: I18n.format(p.deckCount, { count: decks }) });
    return rows;
  }

  function assignmentMetaFor(tag: string): string {
    const c = assignmentCounts[tag];
    if (!c) return I18n.format(p.assignmentMeta, { decks: 0, cards: 0 });
    return I18n.format(p.assignmentMeta, { decks: c.decks, cards: c.cards });
  }

  async function refreshAssignmentCounts() {
    const counts: Record<string, { decks: number; cards: number }> = {};
    for (const mapping of tagMappings) {
      const decks = allDecks.filter(
        (d) => d.tag === mapping.tag || d.tag.startsWith(mapping.tag + "/")
      );
      let cards = 0;
      for (const d of decks) cards += await db.countTotalCards(d.id);
      counts[mapping.tag] = { decks: decks.length, cards };
    }
    assignmentCounts = counts;
  }

  async function selectProfile(profileId: string) {
    selectedProfileId = profileId;
    const profile = profiles.find((pr) => pr.id === profileId);
    if (!profile) return;

    selectedProfile = profile;

    // Load profile settings into form
    profileName = profile.name;
    newCardsLimit = profile.newCardsPerDay;
    reviewCardsLimit = profile.reviewCardsPerDay;
    enableNewCardsLimit = profile.hasNewCardsLimitEnabled;
    enableReviewCardsLimit = profile.hasReviewCardsLimitEnabled;
    reviewOrder = profile.reviewOrder;
    headerLevel = profile.headerLevel;
    extraHeaderLevels = [...(profile.extraHeaderLevels ?? [])];
    requestRetention = profile.fsrs.requestRetention;
    fsrsProfile = profile.fsrs.profile;
    learningSteps = profile.learningSteps;
    relearningSteps = profile.relearningSteps;
    clozeEnabled = profile.clozeEnabled;
    clozeShowContext = profile.clozeShowContext;
    ttsVoice = profile.ttsVoice ?? "";
    ttsRate = profile.ttsRate ?? 1;
    ttsLang = profile.ttsLang ?? "";
    examEnabled = profile.examEnabled ?? false;
    examSettings = { ...DEFAULT_EXAM_SETTINGS, ...(profile.examSettings ?? {}) };

    // Reset validation errors
    nameError = false;
    newCardsError = false;
    reviewCardsError = false;
    retentionError = false;
    learningStepsError = false;
    relearningStepsError = false;

    addTag = "";

    // Load tag mappings, deck count, and the per-tag assignment counts. The
    // awaits let Svelte flush the `bind:this` containers before rebuildSettings.
    tagMappings = await db.getTagMappingsForProfile(profile.id);
    deckCount = await db.getDeckCountForProfile(profile.id);
    await refreshAssignmentCounts();

    rebuildSettings();
  }

  async function handleCreateNewProfile() {
    const defaultProfile = await db.getDefaultProfile();
    const newProfileId = `profile_${Date.now()}`;

    const newProfile: DeckProfile = {
      ...defaultProfile,
      id: newProfileId,
      name: "New Profile",
      isDefault: false,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    await db.createProfile(newProfile);
    await db.save();

    // Reload profiles and select the new one
    profiles = await db.getAllProfiles();
    await selectProfile(newProfileId);

    new Notice(p.noticeProfileCreated);
  }

  async function handleDuplicateProfile() {
    if (!selectedProfile) return;
    const source = selectedProfile;
    const newProfileId = `profile_${Date.now()}`;

    const newProfile: DeckProfile = {
      ...source,
      id: newProfileId,
      name: `${source.name}${p.copySuffix}`,
      isDefault: false,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    await db.createProfile(newProfile);
    await db.save();

    profiles = await db.getAllProfiles();
    await selectProfile(newProfileId);

    new Notice(p.noticeProfileDuplicated);
  }

  async function handleSaveProfile() {
    if (!selectedProfile) return;
    if (saving) return;

    saving = true;

    try {
      // Pre-save validation
      if (!selectedProfile.isDefault && profileName.trim().length === 0) {
        new Notice(p.noticeProfileNameEmpty);
        saving = false;
        return;
      }
      if (enableNewCardsLimit && (isNaN(newCardsLimit) || newCardsLimit < 0 || newCardsLimit > 9999)) {
        new Notice(p.noticeNewCardsRange);
        saving = false;
        return;
      }
      if (enableReviewCardsLimit && (isNaN(reviewCardsLimit) || reviewCardsLimit < 1 || reviewCardsLimit > 9999)) {
        new Notice(p.noticeReviewCardsRange);
        saving = false;
        return;
      }
      if (isNaN(requestRetention) || requestRetention < 0.5 || requestRetention > 0.995) {
        new Notice(p.noticeRequestRetentionRange);
        saving = false;
        return;
      }
      if (learningSteps.trim() !== "") {
        const lsResult = validateLearningSteps(learningSteps, fsrsProfile);
        if (!lsResult.valid) {
          new Notice(lsResult.error ?? p.noticeInvalidAgainInterval);
          saving = false;
          return;
        }
      }
      if (relearningSteps.trim() !== "") {
        const rsResult = validateRelearningSteps(relearningSteps, fsrsProfile);
        if (!rsResult.valid) {
          new Notice(rsResult.error ?? p.noticeInvalidAgainInterval);
          saving = false;
          return;
        }
      }

      const updates: Partial<DeckProfile> = {
        name: profileName,
        newCardsPerDay: newCardsLimit,
        reviewCardsPerDay: reviewCardsLimit,
        hasNewCardsLimitEnabled: enableNewCardsLimit,
        hasReviewCardsLimitEnabled: enableReviewCardsLimit,
        reviewOrder: reviewOrder,
        headerLevel: headerLevel,
        extraHeaderLevels: extraHeaderLevels,
        learningSteps: learningSteps,
        relearningSteps: relearningSteps,
        fsrs: {
          requestRetention: requestRetention,
          profile: fsrsProfile,
        },
        clozeEnabled: clozeEnabled,
        clozeShowContext: clozeShowContext,
        ttsVoice: ttsVoice || undefined,
        ttsRate: ttsRate,
        ttsLang: ttsLang || undefined,
        examEnabled: examEnabled,
        examSettings: { ...examSettings },
        modified: new Date().toISOString(),
      };

      await db.updateProfile(selectedProfile.id, updates);
      await db.save();

      // Reload profiles and reselect current
      profiles = await db.getAllProfiles();
      await selectProfile(selectedProfile.id);

      new Notice(p.noticeProfileSaved);
    } catch (error) {
      console.error("Error saving profile:", error);
      new Notice(p.noticeProfileSaveError);
    } finally {
      saving = false;
    }
  }

  async function handleDeleteProfile() {
    if (!selectedProfile || selectedProfile.isDefault) {
      new Notice(p.noticeCannotDeleteDefault);
      return;
    }

    const confirmDelete = confirm(
      I18n.format(p.confirmDeletePrompt, { name: selectedProfile.name })
    );

    if (!confirmDelete) return;

    await db.deleteProfile(selectedProfile.id);
    await db.save();

    // Reload profiles and select DEFAULT
    profiles = await db.getAllProfiles();
    const defaultProfile = profiles.find((pr) => pr.isDefault);
    if (defaultProfile) {
      await selectProfile(defaultProfile.id);
    }

    new Notice(p.noticeProfileDeleted);
  }

  async function handleApplyTag() {
    if (!selectedProfile || !addTag) return;
    await db.applyProfileToTag(selectedProfile.id, addTag);
    await db.save();
    tagMappings = await db.getTagMappingsForProfile(selectedProfile.id);
    deckCount = await db.getDeckCountForProfile(selectedProfile.id);
    await refreshAssignmentCounts();
    addTag = "";
  }

  async function handleRemoveAssignment(tag: string) {
    if (!selectedProfile) return;
    const confirmRemove = confirm(I18n.format(p.removeAssignmentConfirm, { tag }));
    if (!confirmRemove) return;
    // Applying DEFAULT removes the explicit mapping so the tag re-inherits.
    await db.applyProfileToTag(DEFAULT_PROFILE_ID, tag);
    await db.save();
    tagMappings = await db.getTagMappingsForProfile(selectedProfile.id);
    deckCount = await db.getDeckCountForProfile(selectedProfile.id);
    await refreshAssignmentCounts();
  }

  function rebuildSettings() {
    if (!selectedProfile) return;
    // Capture as a const so narrowing survives inside the callbacks below.
    const profile = selectedProfile;

    // Profile name
    if (profileNameContainer) {
      profileNameContainer.empty();
      new Setting(profileNameContainer)
        .setName(p.profileName)
        .setDesc(p.profileNameDesc)
        .addText((text) => {
          text
            .setValue(profileName)
            .setDisabled(profile.isDefault)
            .onChange((value) => {
              profileName = value;
              if (!profile.isDefault && value.trim().length === 0) {
                nameError = true;
                text.inputEl.addClass("decks-input-error");
              } else {
                nameError = false;
                text.inputEl.removeClass("decks-input-error");
              }
            });
        });
    }

    // Enable new cards limit
    if (enableNewCardsContainer) {
      enableNewCardsContainer.empty();
      new Setting(enableNewCardsContainer)
        .setName(p.limitNewCardsLabel)
        .setDesc(p.limitNewCardsDesc)
        .addToggle((toggle) => {
          toggle.setValue(enableNewCardsLimit).onChange((value) => {
            enableNewCardsLimit = value;
            if (!value) newCardsError = false;
            rebuildSettings();
          });
        });
    }

    // New cards limit
    if (newCardsLimitContainer && enableNewCardsLimit) {
      newCardsLimitContainer.empty();
      new Setting(newCardsLimitContainer)
        .setName(p.newCardsPerDayLabel)
        .setDesc(p.newCardsPerDayDesc)
        .addText((text) => {
          text
            .setValue(newCardsLimit.toString())
            .setPlaceholder("20")
            .onChange((value) => {
              const num = parseInt(value);
              // 0 is valid here: with the limit enabled it means "introduce no
              // new cards" (the Exams preset ships this way).
              if (!isNaN(num) && num >= 0 && num <= 9999) {
                newCardsLimit = num;
                newCardsError = false;
                text.inputEl.removeClass("decks-input-error");
              } else {
                newCardsError = true;
                text.inputEl.addClass("decks-input-error");
              }
            });
        });
    } else if (newCardsLimitContainer) {
      newCardsLimitContainer.empty();
    }

    // Enable review cards limit
    if (enableReviewCardsContainer) {
      enableReviewCardsContainer.empty();
      new Setting(enableReviewCardsContainer)
        .setName(p.limitReviewCardsLabel)
        .setDesc(p.limitReviewCardsDesc)
        .addToggle((toggle) => {
          toggle.setValue(enableReviewCardsLimit).onChange((value) => {
            enableReviewCardsLimit = value;
            if (!value) reviewCardsError = false;
            rebuildSettings();
          });
        });
    }

    // Review cards limit
    if (reviewCardsLimitContainer && enableReviewCardsLimit) {
      reviewCardsLimitContainer.empty();
      new Setting(reviewCardsLimitContainer)
        .setName(p.reviewCardsPerDayLabel)
        .setDesc(p.reviewCardsPerDayDesc)
        .addText((text) => {
          text
            .setValue(reviewCardsLimit.toString())
            .setPlaceholder("100")
            .onChange((value) => {
              const num = parseInt(value);
              if (!isNaN(num) && num >= 1 && num <= 9999) {
                reviewCardsLimit = num;
                reviewCardsError = false;
                text.inputEl.removeClass("decks-input-error");
              } else {
                reviewCardsError = true;
                text.inputEl.addClass("decks-input-error");
              }
            });
        });
    } else if (reviewCardsLimitContainer) {
      reviewCardsLimitContainer.empty();
    }

    // Again interval for new cards
    if (learningStepsContainer) {
      learningStepsContainer.empty();
      new Setting(learningStepsContainer)
        .setName(p.againIntervalNew)
        .setDesc(p.againIntervalNewDesc)
        .addText((text) => {
          text
            .setValue(learningSteps)
            .setPlaceholder(getDefaultLearningSteps(fsrsProfile))
            .onChange((value) => {
              const result = validateLearningSteps(value, fsrsProfile);
              if (result.valid || value.trim() === "") {
                learningSteps = value;
                learningStepsError = false;
                text.inputEl.removeClass("decks-input-error");
              } else {
                learningStepsError = true;
                text.inputEl.addClass("decks-input-error");
              }
            });
        });
    }

    // Again interval for review cards (lapses)
    if (relearningStepsContainer) {
      relearningStepsContainer.empty();
      new Setting(relearningStepsContainer)
        .setName(p.againIntervalReview)
        .setDesc(p.againIntervalReviewDesc)
        .addText((text) => {
          text
            .setValue(relearningSteps)
            .setPlaceholder(getDefaultRelearningSteps(fsrsProfile))
            .onChange((value) => {
              const result = validateRelearningSteps(value, fsrsProfile);
              if (result.valid || value.trim() === "") {
                relearningSteps = value;
                relearningStepsError = false;
                text.inputEl.removeClass("decks-input-error");
              } else {
                relearningStepsError = true;
                text.inputEl.addClass("decks-input-error");
              }
            });
        });
    }

    // Header level
    if (headerLevelContainer) {
      headerLevelContainer.empty();
      new Setting(headerLevelContainer)
        .setName(p.headerLevelLabel)
        .setDesc(p.headerLevelDescParsing)
        .addDropdown((dropdown) => {
          dropdown.addOption("0", t.config.headerTitle);
          for (let i = 1; i <= 6; i++) {
            dropdown.addOption(i.toString(), I18n.format(t.config.headerH, { level: i }));
          }
          dropdown.setValue(headerLevel.toString()).onChange((value) => {
            headerLevel = parseInt(value);
            // Title mode has no extra levels; otherwise the primary level can't
            // also be an "extra".
            extraHeaderLevels =
              headerLevel === 0
                ? []
                : extraHeaderLevels.filter((l) => l !== headerLevel);
            rebuildSettings();
          });
        });
    }

    // Additional header levels also parsed as cards (hidden in title mode).
    // Rendered as a compact multi-select of level chips.
    if (extraHeaderLevelsContainer) {
      extraHeaderLevelsContainer.empty();
      if (headerLevel !== 0) {
        new Setting(extraHeaderLevelsContainer)
          .setName(p.extraHeaderLevelsLabel)
          .setDesc(p.extraHeaderLevelsDesc);
        const chips = extraHeaderLevelsContainer.createDiv({
          cls: "decks-level-multiselect",
        });
        for (let i = 1; i <= 6; i++) {
          if (i === headerLevel) continue;
          const level = i;
          const chip = chips.createEl("button", {
            cls: "decks-level-chip",
            text: I18n.format(t.config.headerH, { level }),
            attr: { type: "button" },
          });
          chip.classList.toggle("mod-cta", extraHeaderLevels.includes(level));
          chip.addEventListener("click", () => {
            const selected = !extraHeaderLevels.includes(level);
            extraHeaderLevels = (
              selected
                ? [...extraHeaderLevels, level]
                : extraHeaderLevels.filter((l) => l !== level)
            ).sort((a, b) => a - b);
            chip.classList.toggle("mod-cta", selected);
          });
        }
      }
    }

    // Cloze enabled toggle
    if (clozeEnabledContainer) {
      clozeEnabledContainer.empty();
      new Setting(clozeEnabledContainer)
        .setName(p.clozeDeletionsLabel)
        .setDesc(p.clozeDeletionsDesc)
        .addToggle((toggle) => {
          toggle.setValue(clozeEnabled).onChange((value) => {
            clozeEnabled = value;
            rebuildSettings();
          });
        });
    }

    // Cloze show context dropdown
    if (clozeShowContextContainer && clozeEnabled) {
      clozeShowContextContainer.empty();
      new Setting(clozeShowContextContainer)
        .setName(p.clozeContextLabel)
        .setDesc(p.clozeContextDesc)
        .addDropdown((dropdown) => {
          dropdown.addOption("open", p.clozeShowOption);
          dropdown.addOption("hidden", p.clozeHideOption);
          dropdown.setValue(clozeShowContext).onChange((value) => {
            clozeShowContext = value as ClozeShowContext;
          });
        });
    } else if (clozeShowContextContainer) {
      clozeShowContextContainer.empty();
    }

    // Exam questions toggle (task list under a heading → multiple-choice).
    // Enabling reinterprets reviewed task-list cards, so warn with the count.
    if (examEnabledContainer) {
      examEnabledContainer.empty();
      new Setting(examEnabledContainer)
        .setName(t.exam.examEnabledSetting)
        .setDesc(t.exam.examEnabledDesc)
        .addToggle((toggle) => {
          toggle.setValue(examEnabled).onChange((value) => {
            if (value && selectedProfile) {
              const toggledProfileId = selectedProfile.id;
              db
                .countReviewedCardsBecomingQuestions(toggledProfileId)
                .then((count) => {
                  // The selection may have moved on while this awaited; applying
                  // to whatever profile is now open would silently mis-toggle it.
                  if (selectedProfile?.id !== toggledProfileId) {
                    return;
                  }
                  if (
                    count > 0 &&
                    !confirm(
                      I18n.format(t.exam.typeFlipWarningBody, {
                        count: String(count),
                      })
                    )
                  ) {
                    toggle.setValue(false);
                    return;
                  }
                  examEnabled = true;
                  rebuildSettings();
                })
                .catch(console.error);
            } else {
              examEnabled = value;
              rebuildSettings();
            }
          });
        });
    }

    // Exam session defaults (pre-fill the exam setup dialog).
    if (examSettingsContainer && examEnabled) {
      examSettingsContainer.empty();
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.questionCountSetting)
        .setDesc(t.exam.questionCountAll)
        .addText((text) =>
          text.setValue(String(examSettings.questionCount)).onChange((value) => {
            const parsed = parseInt(value, 10);
            examSettings.questionCount = Number.isFinite(parsed)
              ? Math.max(0, parsed)
              : 0;
          })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.timeLimitSetting)
        .setDesc(t.exam.timeLimitOff)
        .addText((text) =>
          text
            .setValue(String(examSettings.timeLimitMinutes))
            .onChange((value) => {
              const parsed = parseInt(value, 10);
              examSettings.timeLimitMinutes = Number.isFinite(parsed)
                ? Math.max(0, parsed)
                : 0;
            })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.passScoreSetting)
        .addText((text) =>
          text.setValue(String(examSettings.passScorePct)).onChange((value) => {
            const parsed = parseInt(value, 10);
            examSettings.passScorePct = Number.isFinite(parsed)
              ? Math.max(0, Math.min(100, parsed))
              : 60;
          })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.shuffleQuestionsSetting)
        .addToggle((toggle) =>
          toggle.setValue(examSettings.shuffleQuestions).onChange((value) => {
            examSettings.shuffleQuestions = value;
          })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.shuffleOptionsSetting)
        .addToggle((toggle) =>
          toggle.setValue(examSettings.shuffleOptions).onChange((value) => {
            examSettings.shuffleOptions = value;
          })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.feedbackTimingSetting)
        .addDropdown((dropdown) =>
          dropdown
            .addOption("end", t.exam.feedbackEnd)
            .addOption("immediate", t.exam.feedbackImmediate)
            .setValue(examSettings.feedbackTiming)
            .onChange((value) => {
              examSettings.feedbackTiming = value as ExamFeedbackTiming;
            })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.selectionModeSetting)
        .addDropdown((dropdown) =>
          dropdown
            .addOption("random", t.exam.selectionRandom)
            .addOption("sequential", t.exam.selectionSequential)
            .setValue(examSettings.selectionMode)
            .onChange((value) => {
              examSettings.selectionMode = value as ExamSelectionMode;
            })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.typedGradingSetting)
        .addDropdown((dropdown) =>
          dropdown
            .addOption("exact", t.exam.gradingExact)
            .addOption("tolerant", t.exam.gradingTolerant)
            .addOption("self", t.exam.gradingSelf)
            .setValue(examSettings.typedGrading)
            .onChange((value) => {
              examSettings.typedGrading = value as TypedGradingMode;
            })
        );
      new Setting(examSettingsContainer.createDiv())
        .setName(t.exam.optionLabelsSetting)
        .addDropdown((dropdown) =>
          dropdown
            .addOption("letters", t.exam.optionLabelsLetters)
            .addOption("numbers", t.exam.optionLabelsNumbers)
            .setValue(examSettings.optionLabels)
            .onChange((value) => {
              examSettings.optionLabels = value as ExamOptionLabels;
            })
        );
    } else if (examSettingsContainer) {
      examSettingsContainer.empty();
    }

    // Review order
    if (reviewOrderContainer) {
      reviewOrderContainer.empty();
      new Setting(reviewOrderContainer)
        .setName(p.reviewOrderLabel)
        .setDesc(p.reviewOrderDesc)
        .addDropdown((dropdown) => {
          dropdown.addOption("due-date", t.config.reviewOrderOldestDue);
          dropdown.addOption("random", t.config.reviewOrderRandomLabel);
          dropdown.setValue(reviewOrder).onChange((value) => {
            reviewOrder = value as ReviewOrder;
          });
        });
    }

    // Request retention
    if (requestRetentionContainer) {
      requestRetentionContainer.empty();
      new Setting(requestRetentionContainer)
        .setName(p.requestRetentionLabel)
        .setDesc(p.requestRetentionDesc)
        .addText((text) => {
          text
            .setValue(requestRetention.toString())
            .setPlaceholder("0.9")
            .onChange((value) => {
              const num = parseFloat(value);
              if (!isNaN(num) && num >= 0.5 && num <= 0.995) {
                requestRetention = num;
                retentionError = false;
                text.inputEl.removeClass("decks-input-error");
              } else {
                retentionError = true;
                text.inputEl.addClass("decks-input-error");
              }
            });
        });
    }

    // FSRS profile
    if (fsrsProfileContainer) {
      fsrsProfileContainer.empty();
      const desc = trainedWeightsAvailable
        ? p.fsrsTrainedDesc
        : p.fsrsUntrainedDesc;
      // TRAINED is only selectable once weights exist; otherwise fall back to Standard.
      const currentValue =
        fsrsProfile === "TRAINED" && !trainedWeightsAvailable ? "STANDARD" : fsrsProfile;
      new Setting(fsrsProfileContainer)
        .setName(p.fsrsProfileLabel)
        .setDesc(desc)
        .addDropdown((dropdown) => {
          dropdown.addOption("STANDARD", p.fsrsStandardOption);
          dropdown.addOption(
            "TRAINED",
            trainedWeightsAvailable ? p.fsrsTrainedOption : p.fsrsTrainedUnavailable
          );
          if (!trainedWeightsAvailable) {
            const selectEl = dropdown.selectEl as HTMLSelectElement;
            const opt = Array.from(selectEl.options).find(
              (o) => o.value === "TRAINED"
            );
            if (opt) opt.disabled = true;
          }
          dropdown.setValue(currentValue).onChange((value) => {
            fsrsProfile = value as FSRSProfile;
            rebuildSettings();
          });
        });
    }

    // Read-aloud voice (per profile)
    if (ttsVoiceContainer) {
      ttsVoiceContainer.empty();
      if (ttsService.isAvailable()) {
        const voices = ttsService.listVoices();
        new Setting(ttsVoiceContainer)
          .setName(p.ttsVoiceLabel)
          .setDesc(p.ttsVoiceDesc)
          .addDropdown((dropdown) => {
            dropdown.addOption("", p.ttsVoiceDefault);
            for (const v of voices) {
              dropdown.addOption(v.voiceURI, `${v.name} (${v.lang})`);
            }
            // The stored voice may not exist on this device; fall back to default.
            const known = voices.some((v) => v.voiceURI === ttsVoice);
            dropdown.setValue(known ? ttsVoice : "").onChange((value) => {
              ttsVoice = value;
              const match = voices.find((v) => v.voiceURI === value);
              ttsLang = match ? match.lang : "";
            });
          });
      } else {
        new Setting(ttsVoiceContainer)
          .setName(p.ttsVoiceLabel)
          .setDesc(p.ttsUnavailable)
          .setClass("decks-config-readonly");
      }
    }

    // Read-aloud speed
    if (ttsRateContainer) {
      ttsRateContainer.empty();
      if (ttsService.isAvailable()) {
        new Setting(ttsRateContainer)
          .setName(p.ttsRateLabel)
          .setDesc(p.ttsRateDesc)
          .addSlider((slider) => {
            slider
              .setLimits(0.5, 2, 0.1)
              .setValue(ttsRate)
              .setDynamicTooltip()
              .onChange((value) => {
                ttsRate = value;
              });
          });
      }
    }
  }

  onMount(async () => {
    // Prefer the profile requested by the caller (e.g. a deck's Configure
    // profile action), else DEFAULT.
    const requested =
      (initialProfileId && profiles.find((pr) => pr.id === initialProfileId)) ||
      profiles.find((pr) => pr.isDefault);
    if (requested) {
      await selectProfile(requested.id);
    }
    // Guarantee the settings containers are filled after the first DOM flush.
    await tick();
    rebuildSettings();
  });
</script>

<div class="decks-profiles-manager">
  <!-- Title bar -->
  <div class="decks-pm-titlebar">
    <div class="decks-pm-titlebar-text">
      <div class="decks-pm-title">{p.modalTitle}</div>
      <div class="decks-pm-subtitle">{p.modalSubtitle}</div>
    </div>
    <DocInfoButton path="organizing/profiles" />
  </div>

  <!-- Shared profile picker -->
  <div class="decks-pm-picker">
    <div class="decks-pm-picker-field">
      <div class="decks-pm-picker-label">{p.activeProfileLabel}</div>
      <select
        class="dropdown decks-pm-picker-select"
        value={selectedProfileId}
        on:change={(e) => selectProfile((e.currentTarget).value)}
      >
        {#each profiles as prof (prof.id)}
          <option value={prof.id}>
            {prof.isDefault ? `${prof.name} ${p.defaultSuffix}` : prof.name}
          </option>
        {/each}
      </select>
    </div>
    <button class="mod-cta decks-pm-new" on:click={handleCreateNewProfile}>
      {p.newProfileButton}
    </button>
    <button
      class="clickable-icon decks-pm-icon-btn"
      title={p.duplicateProfile}
      aria-label={p.duplicateProfile}
      on:click={handleDuplicateProfile}
      use:icon={"copy"}
    ></button>
    {#if selectedProfile && !selectedProfile.isDefault}
      <button
        class="clickable-icon decks-pm-icon-btn decks-pm-danger"
        title={p.deleteProfile}
        aria-label={p.deleteProfile}
        on:click={handleDeleteProfile}
        use:icon={"trash-2"}
      ></button>
    {/if}
  </div>

  <!-- Tabs -->
  <div class="decks-pm-tabs">
    <button
      class="decks-pm-tab"
      class:decks-pm-tab-active={activeTab === "settings"}
      on:click={() => (activeTab = "settings")}
    >
      {p.tabSettings}
    </button>
    <button
      class="decks-pm-tab"
      class:decks-pm-tab-active={activeTab === "assignments"}
      on:click={() => (activeTab = "assignments")}
    >
      {p.tabAssignments}
      <span class="decks-pm-badge" class:decks-pm-badge-active={activeTab === "assignments"}>
        {tagMappings.length}
      </span>
    </button>
  </div>

  <!-- Body -->
  <div class="decks-profiles-content">
    {#if selectedProfile}
      <!-- SETTINGS TAB (kept mounted; hidden when inactive so the imperative
           rebuildSettings() fill is never torn down by a conditional mount) -->
      <div class="decks-profile-settings" class:decks-section-hidden={activeTab !== "settings"}>
        <div bind:this={profileNameContainer}></div>

        <div class="decks-settings-section">
          <h4>{p.sectionDailyLimits}</h4>
          <div bind:this={enableNewCardsContainer}></div>
          <div bind:this={newCardsLimitContainer}></div>
          <div bind:this={enableReviewCardsContainer}></div>
          <div bind:this={reviewCardsLimitContainer}></div>
        </div>

        <div class="decks-settings-section">
          <h4>{p.sectionNewCards}</h4>
          <div bind:this={learningStepsContainer}></div>
        </div>

        <div class="decks-settings-section">
          <h4>{p.sectionLapses}</h4>
          <div bind:this={relearningStepsContainer}></div>
        </div>

        <div class="decks-settings-section">
          <h4>{p.sectionCardParsing}</h4>
          <div bind:this={headerLevelContainer}></div>
          <div bind:this={extraHeaderLevelsContainer}></div>
          <div bind:this={clozeEnabledContainer}></div>
          <div bind:this={clozeShowContextContainer}></div>
          <div bind:this={examEnabledContainer}></div>
        </div>

        <div class="decks-settings-section" class:decks-section-hidden={!examEnabled}>
          <h4>{t.exam.examSettingsHeading}</h4>
          <div bind:this={examSettingsContainer} class="decks-exam-settings"></div>
        </div>

        <div class="decks-settings-section">
          <h4>{p.sectionReviewSettings}</h4>
          <div bind:this={reviewOrderContainer}></div>
        </div>

        <div class="decks-settings-section">
          <h4>{p.sectionFsrsAlgorithm}</h4>
          <div bind:this={requestRetentionContainer}></div>
          <div bind:this={fsrsProfileContainer}></div>
        </div>

        <div class="decks-settings-section">
          <h4>{p.sectionReadAloud}</h4>
          <div bind:this={ttsVoiceContainer}></div>
          <div bind:this={ttsRateContainer}></div>
        </div>
      </div>

      <!-- ASSIGNMENTS TAB -->
      <div class="decks-pm-assign" class:decks-section-hidden={activeTab !== "assignments"}>
        <div class="decks-pm-assign-title">
          {I18n.format(p.assignmentsHeading, { name: selectedProfile.name })}
        </div>
        <div class="decks-pm-assign-desc">{p.assignmentsExplainer}</div>

        <div class="decks-pm-add-row">
          <select class="dropdown decks-pm-add-select" bind:value={addTag}>
            <option value="">{p.assignTagPlaceholder}</option>
            {#each assignableTags as tag (tag)}
              <option value={tag}>{tag}</option>
            {/each}
          </select>
          <button class="mod-cta decks-pm-apply" disabled={!addTag} on:click={handleApplyTag}>
            {p.applyButton}
          </button>
        </div>

        <div class="decks-pm-assign-list">
          {#if tagMappings.length === 0}
            <div class="decks-pm-assign-empty">{p.assignmentsEmpty}</div>
          {:else}
            {#each tagMappings as mapping (mapping.id)}
              <div class="decks-pm-assign-item">
                <span class="decks-pm-assign-icon" use:icon={"tag"}></span>
                <div class="decks-pm-assign-info">
                  <div class="decks-pm-assign-tag">{mapping.tag}</div>
                  <div class="decks-pm-assign-meta">{assignmentMetaFor(mapping.tag)}</div>
                </div>
                <button
                  class="clickable-icon decks-pm-assign-remove"
                  title={p.removeTagMapping}
                  aria-label={p.removeTagMapping}
                  on:click={() => handleRemoveAssignment(mapping.tag)}
                  use:icon={"x"}
                ></button>
              </div>
            {/each}
          {/if}
        </div>

        <div class="decks-settings-section">
          <h4>{p.effectiveSettingsHeading}</h4>
          <div class="decks-pm-recap">
            {#each recapRows as row}
              <div class="decks-pm-recap-row">
                <span class="decks-pm-recap-label">{row.label}</span>
                <span class="decks-pm-recap-value">{row.value}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="decks-modal-footer">
    <div class="decks-pm-footer-spacer"></div>
    <button on:click={onclose}>{p.close}</button>
    {#if selectedProfile}
      <button
        class="decks-btn-save"
        on:click={handleSaveProfile}
        disabled={saving || hasErrors}
      >
        {saving ? p.savingChanges : p.saveChanges}
      </button>
    {/if}
  </div>
</div>

<style>
  .decks-profiles-manager {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* Title bar */
  .decks-pm-titlebar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 18px 20px 12px;
    flex-shrink: 0;
  }

  .decks-pm-title {
    font-size: var(--font-ui-large);
    font-weight: var(--font-bold);
    color: var(--text-normal);
  }

  .decks-pm-subtitle {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* Shared profile picker */
  .decks-pm-picker {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 0 20px 14px;
    flex-shrink: 0;
  }

  .decks-pm-picker-field {
    flex: 1;
    min-width: 0;
  }

  .decks-pm-picker-label {
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-normal);
    margin-bottom: 5px;
  }

  .decks-pm-picker-select {
    width: 100%;
  }

  .decks-pm-new {
    flex-shrink: 0;
  }

  .decks-pm-icon-btn {
    flex-shrink: 0;
  }

  .decks-pm-danger {
    color: var(--text-error);
  }

  /* Tabs */
  .decks-pm-tabs {
    display: flex;
    gap: 2px;
    padding: 0 20px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
  }

  .decks-pm-tab {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px;
    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    box-shadow: none;
  }

  .decks-pm-tab:hover {
    color: var(--text-normal);
  }

  .decks-pm-tab-active {
    color: var(--text-accent);
    border-bottom-color: var(--interactive-accent);
  }

  .decks-pm-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 19px;
    height: 19px;
    padding: 0 5px;
    border-radius: 10px;
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-bold);
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .decks-pm-badge-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .decks-profiles-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 20px 20px;
    min-height: 0;
  }

  .decks-profile-settings {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .decks-settings-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .decks-settings-section h4 {
    margin: 0;
    font-size: 0.9em;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .decks-section-hidden {
    display: none !important;
  }

  /* Same row rhythm as .decks-settings-section: each setting sits in its own
     child div, so the flex gap (not setting-item padding) spaces the rows. */
  .decks-exam-settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Assignments tab */
  .decks-pm-assign {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .decks-pm-assign-title {
    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
  }

  .decks-pm-assign-desc {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    margin-top: -6px;
  }

  .decks-pm-add-row {
    display: flex;
    gap: 10px;
  }

  .decks-pm-add-select {
    flex: 1;
    min-width: 0;
  }

  .decks-pm-apply {
    flex-shrink: 0;
  }

  .decks-pm-assign-list {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    overflow: hidden;
  }

  .decks-pm-assign-empty {
    padding: 26px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  .decks-pm-assign-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
  }

  .decks-pm-assign-item:not(:last-child) {
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-pm-assign-icon {
    display: flex;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .decks-pm-assign-icon :global(svg) {
    width: 16px;
    height: 16px;
  }

  .decks-pm-assign-info {
    flex: 1;
    min-width: 0;
  }

  .decks-pm-assign-tag {
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .decks-pm-assign-meta {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    margin-top: 1px;
  }

  .decks-pm-assign-remove {
    flex-shrink: 0;
  }

  .decks-pm-assign-remove:hover {
    color: var(--text-error);
  }

  /* Effective-settings recap */
  .decks-pm-recap {
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    padding: 4px 14px;
  }

  .decks-pm-recap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 0;
  }

  .decks-pm-recap-row:not(:last-child) {
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .decks-pm-recap-label {
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }

  .decks-pm-recap-value {
    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
    text-align: right;
  }

  :global(.decks-input-error) {
    border-color: var(--text-error) !important;
  }

  :global(.decks-config-readonly .setting-item-control) {
    display: none;
  }

  :global(.decks-config-readonly .setting-item-description) {
    font-weight: 500;
    color: var(--text-normal);
  }

  .decks-modal-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    padding: 14px 20px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .decks-pm-footer-spacer {
    flex: 1;
  }

  .decks-modal-footer > button {
    padding: 8px 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    cursor: pointer;
  }

  .decks-modal-footer > button:hover {
    background: var(--background-modifier-hover);
  }

  .decks-btn-save {
    padding: 8px 18px;
    background: var(--interactive-accent) !important;
    color: var(--text-on-accent);
    border: none !important;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .decks-btn-save:hover {
    background: var(--interactive-accent-hover) !important;
  }

  .decks-btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    .decks-profiles-content {
      padding: 12px 15px 15px;
    }
  }
</style>
