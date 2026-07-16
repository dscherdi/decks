<script lang="ts">
  import { onMount } from "svelte";
  import { Setting, Notice } from "obsidian";
  import type { DeckProfile, ProfileTagMapping, ClozeShowContext } from "../../database/types";
  import type { IDatabaseService } from "../../database/DatabaseFactory";
  import type { ReviewOrder, FSRSProfile } from "../../database/types";
  import type {
    ExamFeedbackTiming,
    ExamOptionLabels,
    ExamSelectionMode,
    ExamSettings,
    TypedGradingMode,
  } from "../../database/types";
  import { getDefaultLearningSteps, getDefaultRelearningSteps, DEFAULT_EXAM_SETTINGS, I18n, validateLearningSteps, validateRelearningSteps } from "@decks/core";

  const t = I18n.t;
  const p = t.profiles;

  export let db: IDatabaseService;
  export let initialProfiles: DeckProfile[];
  export let onclose: () => void;
  export let trainedWeightsAvailable = false;

  let profiles: DeckProfile[] = initialProfiles;
  let selectedProfileId = "";
  let selectedProfile: DeckProfile | null = null;
  let tagMappings: ProfileTagMapping[] = [];
  let deckCount = 0;

  let profileSelectorContainer: HTMLElement;
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
  let examEnabledContainer: HTMLElement;
  let examSettingsContainer: HTMLElement;
  let deckCountContainer: HTMLElement;
  let tagMappingsContainer: HTMLElement;

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

  // Track last event to prevent double execution
  let lastEventTime = 0;
  let lastEventType = "";

  async function selectProfile(profileId: string) {
    selectedProfileId = profileId;
    const profile = profiles.find((p) => p.id === profileId);
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
    examEnabled = profile.examEnabled ?? false;
    examSettings = { ...DEFAULT_EXAM_SETTINGS, ...(profile.examSettings ?? {}) };

    // Reset validation errors
    nameError = false;
    newCardsError = false;
    reviewCardsError = false;
    retentionError = false;
    learningStepsError = false;
    relearningStepsError = false;

    // Load tag mappings and deck count
    tagMappings = await db.getTagMappingsForProfile(profile.id);
    deckCount = await db.getDeckCountForProfile(profile.id);

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
    rebuildProfileSelector();

    new Notice(p.noticeProfileCreated);
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
      if (enableNewCardsLimit && (isNaN(newCardsLimit) || newCardsLimit < 1 || newCardsLimit > 9999)) {
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
        examEnabled: examEnabled,
        examSettings: { ...examSettings },
        modified: new Date().toISOString(),
      };

      await db.updateProfile(selectedProfile.id, updates);
      await db.save();

      // Reload profiles and reselect current
      profiles = await db.getAllProfiles();
      await selectProfile(selectedProfile.id);
      rebuildProfileSelector();

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
    const defaultProfile = profiles.find((p) => p.isDefault);
    if (defaultProfile) {
      await selectProfile(defaultProfile.id);
    }
    rebuildProfileSelector();

    new Notice(p.noticeProfileDeleted);
  }

  async function handleRemoveTagMapping(mappingId: string) {
    await db.deleteTagMapping(mappingId);
    await db.save();

    // Reload tag mappings
    if (selectedProfile) {
      tagMappings = await db.getTagMappingsForProfile(selectedProfile.id);
      rebuildSettings();
    }
  }

  function rebuildAll() {
    rebuildProfileSelector();
    rebuildSettings();
  }

  function rebuildProfileSelector() {
    if (!profileSelectorContainer) return;

    profileSelectorContainer.empty();

    new Setting(profileSelectorContainer)
      .setName(p.selectProfile)
      .setDesc(p.chooseProfileDesc)
      .addDropdown((dropdown) => {
        for (const profile of profiles) {
          const label = profile.isDefault
            ? `${profile.name} ${p.defaultSuffix}`
            : profile.name;
          dropdown.addOption(profile.id, label);
        }

        dropdown.setValue(selectedProfileId);

        dropdown.onChange((value) => {
          const now = Date.now();
          const eventId = `profile-selector-${value}`;
          if (now - lastEventTime < 100 && lastEventType === eventId) {
            return;
          }
          lastEventTime = now;
          lastEventType = eventId;

          selectProfile(value);
        });
      })
      .addButton((button) => {
        button
          .setButtonText(p.createNewProfile)
          .setTooltip(p.createTooltip)
          .onClick(() => {
            handleCreateNewProfile();
          });
      });
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
              if (!isNaN(num) && num >= 1 && num <= 9999) {
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
              db
                .countReviewedCardsBecomingQuestions(selectedProfile.id)
                .then((count) => {
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
      new Setting(examSettingsContainer)
        .setName(t.exam.examSettingsHeading)
        .setHeading();
      new Setting(examSettingsContainer)
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
      new Setting(examSettingsContainer)
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
      new Setting(examSettingsContainer)
        .setName(t.exam.passScoreSetting)
        .addText((text) =>
          text.setValue(String(examSettings.passScorePct)).onChange((value) => {
            const parsed = parseInt(value, 10);
            examSettings.passScorePct = Number.isFinite(parsed)
              ? Math.max(0, Math.min(100, parsed))
              : 60;
          })
        );
      new Setting(examSettingsContainer)
        .setName(t.exam.shuffleQuestionsSetting)
        .addToggle((toggle) =>
          toggle.setValue(examSettings.shuffleQuestions).onChange((value) => {
            examSettings.shuffleQuestions = value;
          })
        );
      new Setting(examSettingsContainer)
        .setName(t.exam.shuffleOptionsSetting)
        .addToggle((toggle) =>
          toggle.setValue(examSettings.shuffleOptions).onChange((value) => {
            examSettings.shuffleOptions = value;
          })
        );
      new Setting(examSettingsContainer)
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
      new Setting(examSettingsContainer)
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
      new Setting(examSettingsContainer)
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
      new Setting(examSettingsContainer)
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

    // Deck count
    if (deckCountContainer) {
      deckCountContainer.empty();
      new Setting(deckCountContainer)
        .setName(p.decksUsingProfile)
        .setDesc(I18n.format(p.deckCount, { count: deckCount }))
        .setClass("decks-config-readonly");
    }

    // Tag mappings
    if (tagMappingsContainer) {
      tagMappingsContainer.empty();
      if (tagMappings.length > 0) {
        tagMappingsContainer.createEl("h4", {
          text: p.tagAssignmentsHeading,
          cls: "decks-button-container",
        });

        const mappingsDiv = tagMappingsContainer.createDiv(
          "decks-tag-mappings"
        );
        for (const mapping of tagMappings) {
          const item = mappingsDiv.createDiv("decks-tag-mapping-item");
          item.createSpan({ text: `🏷️ ${mapping.tag}` });
          const removeBtn = item.createEl("button", {
            text: "✕",
            cls: "decks-btn-remove-tag",
          });
          removeBtn.addEventListener("click", () => {
            handleRemoveTagMapping(mapping.id);
          });
        }
      }
    }
  }

  onMount(async () => {
    // Select DEFAULT profile by default
    const defaultProfile = profiles.find((p) => p.isDefault);
    if (defaultProfile) {
      await selectProfile(defaultProfile.id);
    }

    rebuildAll();
  });
</script>

<div class="decks-profiles-manager">
  <div class="decks-profiles-content">
    <div bind:this={profileSelectorContainer}></div>

    {#if selectedProfile}
      <div class="decks-profile-settings">
        <h3>{p.profileSettings}</h3>

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
          <div bind:this={examSettingsContainer}></div>
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
          <h4>{p.sectionProfileInfo}</h4>
          <div bind:this={deckCountContainer}></div>
          <div bind:this={tagMappingsContainer}></div>
        </div>

      </div>
    {/if}
  </div>

  <div class="decks-modal-footer">
    {#if selectedProfile}
      <div class="decks-profile-actions">
        <button
          class="decks-btn-save"
          on:click={handleSaveProfile}
          disabled={saving || hasErrors}
        >
          {saving ? p.savingChanges : p.saveChanges}
        </button>
        {#if !selectedProfile.isDefault}
          <button class="decks-btn-delete" on:click={handleDeleteProfile}>
            {p.deleteProfileButton}
          </button>
        {/if}
      </div>
    {/if}
    <button on:click={onclose}>{p.close}</button>
  </div>
</div>

<style>
  .decks-profiles-manager {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .decks-profiles-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 20px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .decks-profile-settings {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .decks-profile-settings h3 {
    margin: 0;
    font-size: 1.2em;
    color: var(--text-normal);
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

  .decks-profile-actions {
    display: flex;
    gap: 10px;
    flex: 1;
  }

  .decks-btn-save {
    flex: 1;
    padding: 10px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .decks-btn-save:hover {
    background: var(--interactive-accent-hover);
  }

  .decks-btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .decks-btn-delete {
    padding: 10px 20px;
    background: var(--text-error);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
  }

  .decks-btn-delete:hover {
    opacity: 0.8;
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

  :global(.decks-tag-mappings) {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  :global(.decks-tag-mapping-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--background-modifier-hover);
    border-radius: 4px;
  }

  :global(.decks-btn-remove-tag) {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0 5px;
    font-size: 1.2em;
  }

  :global(.decks-btn-remove-tag:hover) {
    color: var(--text-error);
  }

  .decks-modal-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    padding: 15px 20px;
    border-top: 1px solid var(--background-modifier-border);
  }

  /* Only the direct-child Close button gets the neutral footer styling; the
     accent Save / Delete buttons live inside .decks-profile-actions and keep
     their own styles (a descendant selector here would override them). */
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

  @media (max-width: 768px) {
    .decks-profiles-content {
      padding: 15px;
    }

    .decks-profile-actions {
      flex-direction: column;
    }

    .decks-btn-save,
    .decks-btn-delete {
      width: 100%;
    }
  }
</style>
