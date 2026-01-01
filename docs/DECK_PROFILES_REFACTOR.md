# Deck Configuration Profiles Refactor

**Status**: ✅ Completed
**Version**: 2.0.0 (Breaking Change)
**Date**: December 29, 2025

## Overview

This document describes the major architectural refactor that moved deck configuration from inline JSON in the `decks` table to a separate `deckprofiles` table with shared profile support.

## Motivation

### Problems with Old System

1. **Code Duplication**: Each deck stored its own configuration, leading to duplicated settings across decks
2. **Difficult to Update**: Changing settings for multiple decks required updating each deck individually
3. **No Standardization**: No way to enforce consistent settings across related decks
4. **Tag-Based Management**: No automatic profile assignment based on deck tags

### Benefits of New System

1. **Shared Profiles**: Multiple decks can use the same profile
2. **Centralized Management**: Edit one profile, affect all decks using it
3. **Tag-Based Auto-Assignment**: New decks automatically get profiles based on their tags
4. **DEFAULT Profile**: Guaranteed fallback profile that cannot be deleted
5. **Unified UI**: Single modal for both deck and profile configuration

## Architecture Changes

### Database Schema (v6 → v7)

#### New Tables

**deckprofiles**
```sql
CREATE TABLE deckprofiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  has_new_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
  new_cards_per_day INTEGER NOT NULL DEFAULT 20,
  has_review_cards_limit_enabled INTEGER NOT NULL DEFAULT 0,
  review_cards_per_day INTEGER NOT NULL DEFAULT 100,
  header_level INTEGER NOT NULL DEFAULT 2,
  review_order TEXT NOT NULL DEFAULT 'due-date',
  fsrs_request_retention REAL NOT NULL DEFAULT 0.9,
  fsrs_profile TEXT NOT NULL DEFAULT 'STANDARD',
  is_default INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  modified TEXT NOT NULL
);
```

**profile_tag_mappings**
```sql
CREATE TABLE profile_tag_mappings (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created TEXT NOT NULL,
  UNIQUE(profile_id, tag)
);
```

#### Modified Tables

**decks** - Changed from:
```sql
CREATE TABLE decks (
  -- ... other fields
  config TEXT NOT NULL,  -- JSON blob
  -- ...
);
```

To:
```sql
CREATE TABLE decks (
  -- ... other fields
  profile_id TEXT NOT NULL,  -- Reference to deckprofiles.id
  -- ...
);
```

### Type System Changes

#### Removed Types

- `DeckConfig` interface (replaced by `DeckProfile`)

#### New Types

```typescript
export interface DeckProfile {
  id: string;
  name: string;
  hasNewCardsLimitEnabled: boolean;
  newCardsPerDay: number;
  hasReviewCardsLimitEnabled: boolean;
  reviewCardsPerDay: number;
  headerLevel: number;
  reviewOrder: ReviewOrder;
  fsrs: {
    requestRetention: number;
    profile: "INTENSIVE" | "STANDARD";
  };
  isDefault: boolean;
  created: string;
  modified: string;
}

export interface ProfileTagMapping {
  id: string;
  profileId: string;
  tag: string;
  created: string;
}

export interface DeckWithProfile extends Deck {
  profile: DeckProfile;
}
```

#### Updated Types

```typescript
// Before
export interface Deck {
  // ...
  config: DeckConfig;
}

// After
export interface Deck {
  // ...
  profileId: string;
}
```

## Database Service API

### New Methods

#### Profile CRUD

```typescript
// Create a new profile
createProfile(profile: Omit<DeckProfile, 'created' | 'modified'>): Promise<string>

// Get profile by ID
getProfileById(id: string): Promise<DeckProfile | null>

// Get profile by name
getProfileByName(name: string): Promise<DeckProfile | null>

// Get all profiles (DEFAULT first)
getAllProfiles(): Promise<DeckProfile[]>

// Get the DEFAULT profile
getDefaultProfile(): Promise<DeckProfile>

// Update profile (cannot rename DEFAULT or change isDefault)
updateProfile(
  id: string,
  updates: Partial<Omit<DeckProfile, 'id' | 'created' | 'modified' | 'isDefault'>>
): Promise<void>

// Delete profile (cannot delete DEFAULT, resets affected decks to DEFAULT)
deleteProfile(id: string): Promise<void>

// Get count of decks using a profile
getDeckCountForProfile(profileId: string): Promise<number>

// Get all decks using a profile
getDecksByProfile(profileId: string): Promise<Deck[]>
```

#### Tag Mapping

```typescript
// Create tag-to-profile mapping
createTagMapping(profileId: string, tag: string): Promise<string>

// Get all tag mappings for a profile
getTagMappingsForProfile(profileId: string): Promise<ProfileTagMapping[]>

// Get profile ID for a tag (for auto-assignment)
getProfileIdForTag(tag: string): Promise<string | null>

// Delete tag mapping
deleteTagMapping(id: string): Promise<void>

// Apply profile to all decks with a tag
applyProfileToTag(profileId: string, tag: string): Promise<number>
```

#### Backward Compatibility Helpers

```typescript
// Get deck with resolved profile (for gradual migration)
getDeckWithProfile(deckId: string): Promise<DeckWithProfile | null>

// Get all decks with resolved profiles
getAllDecksWithProfiles(): Promise<DeckWithProfile[]>
```

### Updated Methods

```typescript
// Auto-assigns profile by tag if no profileId provided
createDeck(
  deck: Omit<Deck, "created" | "modified" | "profileId"> & {
    id?: string;
    profileId?: string
  }
): Promise<string>
```

## Migration Strategy

### Data Migration (v6 → v7)

1. Create DEFAULT profile with standard settings
2. Create new `deckprofiles` and `profile_tag_mappings` tables
3. Create new `decks_new` table with `profile_id` instead of `config`
4. Migrate all existing decks to reference DEFAULT profile
5. Drop old tables, rename new tables
6. Create indexes
7. Update `PRAGMA user_version = 7`

### Data Loss

**Per-deck config customizations are lost during migration.** All decks will use the DEFAULT profile after migration. Users can create custom profiles and reassign decks post-migration.

### Fresh Database Setup

For new database installations (integration tests, new users):
- DEFAULT profile is created automatically via `CREATE_TABLES_SQL`
- All new decks use DEFAULT profile unless explicitly assigned

## Service Layer Updates

### Scheduler Service

All places where `deck.config` was accessed now use `deck.profile`:

```typescript
// Before
const deck = await this.db.getDeckById(deckId);
if (deck.config.hasNewCardsLimitEnabled) {
  // ...
}

// After
const deck = await this.db.getDeckWithProfile(deckId);
if (deck.profile.hasNewCardsLimitEnabled) {
  // ...
}
```

**Key Changes**:
- `getDeckById()` → `getDeckWithProfile()`
- `deck.config` → `deck.profile`
- All FSRS parameter access updated
- Daily limits logic updated
- Review order logic updated

### Statistics Service

Similar changes to Scheduler:
- Uses `getDeckWithProfile()` instead of `getDeckById()`
- Accesses `deck.profile` instead of `deck.config`
- Simulation logic respects profile settings

### DeckManager Service

**Auto-assignment logic added**:
```typescript
// When creating a deck, check for tag mapping
const profileId = await this.db.getProfileIdForTag(tag);
if (profileId) {
  deck.profileId = profileId;
} else {
  deck.profileId = DEFAULT_PROFILE_ID;
}
```

## UI Components

### Unified Deck Configuration Modal

**File**: `src/components/config/DeckConfigModal.ts`

**Design**: Single panel with two dropdowns and editable profile settings (inspired by Anki)

**Layout**:
```
┌─────────────────────────────────────────┐
│ Configure Deck & Profile                │
├─────────────────────────────────────────┤
│ Deck Selection                          │
│ [Dropdown: My Math Notes ▼]             │
├─────────────────────────────────────────┤
│ Profile Selection                       │
│ [Dropdown: Math Profile ▼]              │
├─────────────────────────────────────────┤
│ Profile Settings (applies to all decks) │
│                                         │
│ Daily Limits:                           │
│ ☑ Limit new cards   [10] per day        │
│ ☐ Limit reviews                         │
│                                         │
│ Flashcard Parsing:                      │
│ Header Level: [H2 ▼]                    │
│                                         │
│ Review Settings:                        │
│ Order: [Oldest due first ▼]             │
│                                         │
│ FSRS Algorithm:                         │
│ Retention: [0.90]                       │
│ Profile: [Standard ▼]                   │
├─────────────────────────────────────────┤
│              [Cancel]  [Save]           │
└─────────────────────────────────────────┘
```

**Features**:
1. **Deck Selector**: Switch between decks without closing modal
2. **Profile Selector**: Assign different profile to selected deck
3. **Profile Editor**: Edit profile settings (affects all decks using that profile)
4. **Smart Resync**: Automatically resyncs deck if headerLevel changes
5. **Mobile Responsive**: Adapts layout for mobile devices

**Save Behavior**:
- Saves profile updates (applies to ALL decks using that profile)
- Assigns selected profile to selected deck
- Triggers deck resync if headerLevel changed

### Removed Components

- `ProfilesManagerModal.ts` (merged into DeckConfigModal)
- `ProfilesManagerUI.svelte` (merged into DeckConfigUI)

## Key Features

### 1. Shared Profiles

Multiple decks can use the same profile:

```typescript
// Create a custom profile
const mathProfileId = await db.createProfile({
  id: "profile_math",
  name: "Math Profile",
  newCardsPerDay: 10,
  hasNewCardsLimitEnabled: true,
  // ... other settings
  isDefault: false,
});

// Assign to multiple decks
await db.updateDeck("deck1", { profileId: mathProfileId });
await db.updateDeck("deck2", { profileId: mathProfileId });

// Edit profile once, affects both decks
await db.updateProfile(mathProfileId, {
  newCardsPerDay: 15,
});
```

### 2. Tag-Based Auto-Assignment

Automatically assign profiles to new decks based on tags:

```typescript
// Create mapping: all decks with #math tag use Math Profile
await db.createTagMapping("profile_math", "#math");

// When creating a deck with #math tag, it automatically gets Math Profile
const deck = await db.createDeck({
  name: "Calculus",
  tag: "#math",
  filepath: "/calculus.md",
  // profileId is auto-assigned based on tag mapping
});
```

### 3. DEFAULT Profile Protection

The DEFAULT profile has special protections:

- **Cannot be deleted**: `deleteProfile()` rejects DEFAULT profile
- **Cannot be renamed**: Name is always "DEFAULT"
- **isDefault flag immutable**: Cannot be changed after creation
- **Fallback behavior**: When a profile is deleted, all affected decks reset to DEFAULT

### 4. Profile Deletion Safety

When deleting a non-DEFAULT profile:

```typescript
await db.deleteProfile("profile_math");
// 1. All decks using "profile_math" are reset to DEFAULT
// 2. All tag mappings for "profile_math" are deleted
// 3. Profile is removed from database
```

## Testing Updates

### Integration Tests Fixed

All integration tests updated to work with profiles:

1. **database-test-utils.ts**: `createTestDeck()` now uses `profileId`
2. **scheduler-integration.test.ts**: Updates profile instead of deck config
3. **large-deck-integration.test.ts**: Updates profile before syncing
4. **fsrs-integration.test.ts**: Creates custom profiles for retention tests
5. **statistics-integration.test.ts**: Updates profile for daily limit tests

### Test Results

- **Unit tests**: ✅ 185 passed (15 suites)
- **Integration tests**: ✅ 94 passed (8 suites)
- **Total**: ✅ 279 tests passed

### Key Test Fix

**Problem**: Integration tests create fresh databases, but DEFAULT profile was only created during migration (v6→v7), not in `CREATE_TABLES_SQL`.

**Solution**: Added DEFAULT profile insertion to `CREATE_TABLES_SQL` in schemas.ts:

```sql
-- Insert DEFAULT profile
INSERT OR IGNORE INTO deckprofiles (
  id, name,
  has_new_cards_limit_enabled, new_cards_per_day,
  has_review_cards_limit_enabled, review_cards_per_day,
  header_level, review_order,
  fsrs_request_retention, fsrs_profile,
  is_default, created, modified
) VALUES (
  'profile_default',
  'DEFAULT',
  0, 20,
  0, 100,
  2, 'due-date',
  0.9, 'STANDARD',
  1,
  datetime('now'),
  datetime('now')
);
```

## Breaking Changes

### For Users

1. **Configuration Loss**: Per-deck configurations are lost during migration. All decks will use DEFAULT profile.
2. **Major Version Bump**: This is a breaking change requiring update to 2.0.0
3. **No Rollback**: Old plugin versions cannot read schema v7

### For Developers

1. **API Changes**:
   - `getDeckById()` returns `Deck` without config
   - Use `getDeckWithProfile()` to get `DeckWithProfile` with resolved profile
   - `deck.config` removed, use `deck.profile` instead
   - `DeckConfig` type removed, use `DeckProfile` instead

2. **Database Schema**: Schema version 7 is incompatible with older versions

3. **Service Layer**: All services must use `getDeckWithProfile()` when accessing configuration

## Migration Guide for Developers

### Updating Code to Use Profiles

**Before**:
```typescript
const deck = await db.getDeckById(deckId);
if (deck.config.hasNewCardsLimitEnabled) {
  const limit = deck.config.newCardsPerDay;
  // ...
}
```

**After**:
```typescript
const deck = await db.getDeckWithProfile(deckId);
if (deck.profile.hasNewCardsLimitEnabled) {
  const limit = deck.profile.newCardsPerDay;
  // ...
}
```

### Creating Decks

**Before**:
```typescript
const deck = await db.createDeck({
  name: "My Deck",
  tag: "#test",
  filepath: "/test.md",
  config: {
    hasNewCardsLimitEnabled: true,
    newCardsPerDay: 10,
    // ... all config fields
  },
});
```

**After**:
```typescript
const deck = await db.createDeck({
  name: "My Deck",
  tag: "#test",
  filepath: "/test.md",
  // profileId is optional - auto-assigned by tag or uses DEFAULT
});

// Or explicitly assign a profile
const deck = await db.createDeck({
  name: "My Deck",
  tag: "#test",
  filepath: "/test.md",
  profileId: "profile_math",
});
```

### Updating Tests

**Before**:
```typescript
const deck = {
  id: "test-deck",
  name: "Test",
  config: {
    hasNewCardsLimitEnabled: true,
    newCardsPerDay: 10,
    // ...
  },
};
```

**After**:
```typescript
const deck = {
  id: "test-deck",
  name: "Test",
  profileId: "profile_default",
};

// Update profile if needed
const profile = await db.getDefaultProfile();
await db.updateProfile(profile.id, {
  hasNewCardsLimitEnabled: true,
  newCardsPerDay: 10,
});
```

## Performance Considerations

### Database Indexes

New indexes added for efficient queries:

```sql
CREATE INDEX idx_deckprofiles_name ON deckprofiles(name);
CREATE INDEX idx_deckprofiles_is_default ON deckprofiles(is_default);
CREATE INDEX idx_profile_tag_mappings_profile ON profile_tag_mappings(profile_id);
CREATE INDEX idx_profile_tag_mappings_tag ON profile_tag_mappings(tag);
CREATE INDEX idx_decks_profile_id ON decks(profile_id);
```

### Query Optimization

- `getDeckWithProfile()` uses single JOIN query
- Tag mapping lookup uses indexed tag column
- Profile queries cached at service layer where appropriate

## User Guide

### Creating Custom Profiles

1. Open any deck configuration modal
2. Select a deck and profile from dropdowns
3. Modify profile settings as needed
4. Click **Save** to apply changes to all decks using that profile

### Tag-Based Auto-Assignment

1. Create a custom profile (e.g., "Math Profile")
2. Use the profile manager to create tag mapping: #math → Math Profile
3. Any new deck with #math tag automatically gets Math Profile

### Managing Profiles

**View Decks Using a Profile**:
```typescript
const decks = await db.getDecksByProfile("profile_math");
const count = await db.getDeckCountForProfile("profile_math");
```

**Bulk Apply Profile to Tag**:
```typescript
// Apply Math Profile to all existing decks with #math tag
const updatedCount = await db.applyProfileToTag("profile_math", "#math");
```

## Future Enhancements

### Potential Features

1. **Profile Import/Export**: Share profiles between vaults
2. **Profile Templates**: Pre-configured profiles for common use cases
3. **Profile Inheritance**: Create profiles that inherit from others
4. **Profile Analytics**: Show statistics per profile
5. **Deck-Level Overrides**: Allow individual decks to override specific profile settings

### Technical Debt

1. **Service Layer Migration**: Some services still use `getDeckById()` + manual profile lookup
2. **UI Polish**: Modal could benefit from profile creation/deletion within the same interface
3. **Validation**: Add more robust validation for profile settings
4. **Documentation**: Add user-facing documentation for profile features

## References

### Related Files

- **Database**: [src/database/schemas.ts](src/database/schemas.ts), [src/database/types.ts](src/database/types.ts)
- **Services**: [src/services/Scheduler.ts](src/services/Scheduler.ts), [src/services/StatisticsService.ts](src/services/StatisticsService.ts)
- **UI**: [src/components/config/DeckConfigModal.ts](src/components/config/DeckConfigModal.ts), [src/components/config/DeckConfigUI.svelte](src/components/config/DeckConfigUI.svelte)
- **Tests**: [src/__tests__/integration/](src/__tests__/integration/)

### Documentation

- Implementation Plan: [~/.claude/plans/buzzing-wibbling-floyd.md](~/.claude/plans/buzzing-wibbling-floyd.md)
- CLAUDE.md: [CLAUDE.md](../CLAUDE.md)

## Changelog

### v2.0.0 (2025-12-29)

**Breaking Changes**:
- ⚠️ Database schema upgraded to v7
- ⚠️ Per-deck configurations migrated to DEFAULT profile
- ⚠️ `DeckConfig` type removed
- ⚠️ `Deck` interface changed from `config` to `profileId`

**Features**:
- ✨ Shared profile system with DEFAULT profile
- ✨ Tag-based auto-assignment of profiles
- ✨ Unified deck/profile configuration modal
- ✨ Profile CRUD operations
- ✨ Profile tag mapping system
- ✨ Backward compatibility helpers

**Fixes**:
- 🐛 DEFAULT profile now created for fresh databases
- 🐛 All integration tests updated and passing
- 🐛 HeaderLevel changes trigger automatic deck resync

**Tests**:
- ✅ 279 tests passing (185 unit + 94 integration)
- ✅ All test files updated for profile system
