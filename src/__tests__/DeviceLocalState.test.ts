import { DeviceLocalState, type LocalStorageLike } from "../services/DeviceLocalState";

class InMemoryStorage implements LocalStorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  // Test helper
  raw(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

describe("DeviceLocalState", () => {
  describe("deviceId", () => {
    it("generates and persists a fresh deviceId on first construction", () => {
      const storage = new InMemoryStorage();
      const s = new DeviceLocalState(storage);
      const id = s.getDeviceId();
      expect(id).toMatch(/^[a-z]+-[a-f0-9]{12}$/);
      expect(storage.raw().decks_device_id).toBe(id);
    });

    it("reuses an existing deviceId from storage", () => {
      const storage = new InMemoryStorage();
      storage.setItem("decks_device_id", "mac-deadbeef1234");
      const s = new DeviceLocalState(storage);
      expect(s.getDeviceId()).toBe("mac-deadbeef1234");
    });

    it("two instances on the same storage share a deviceId", () => {
      const storage = new InMemoryStorage();
      const a = new DeviceLocalState(storage);
      const b = new DeviceLocalState(storage);
      expect(a.getDeviceId()).toBe(b.getDeviceId());
    });

    it("two instances on different storage produce different deviceIds", () => {
      const a = new DeviceLocalState(new InMemoryStorage());
      const b = new DeviceLocalState(new InMemoryStorage());
      expect(a.getDeviceId()).not.toBe(b.getDeviceId());
    });
  });

  describe("seq counter", () => {
    it("starts at SKIP_AHEAD on a fresh device", () => {
      const storage = new InMemoryStorage();
      const s = new DeviceLocalState(storage);
      expect(s.takeSeq()).toBe(100);
      expect(s.takeSeq()).toBe(101);
    });

    it("persists each increment synchronously", () => {
      const storage = new InMemoryStorage();
      const s = new DeviceLocalState(storage);
      s.takeSeq();
      expect(storage.raw().decks_sync_seq).toBe("101");
      s.takeSeq();
      expect(storage.raw().decks_sync_seq).toBe("102");
    });

    it("skips ahead on the next construction (crash-recovery guard)", () => {
      const storage = new InMemoryStorage();
      const a = new DeviceLocalState(storage);
      const first = a.takeSeq();
      const second = a.takeSeq();
      // Simulate a hard kill, then restart.
      const b = new DeviceLocalState(storage);
      const third = b.takeSeq();
      // The fresh instance must produce a seq strictly greater than any
      // previously-issued, even if a few in-memory increments were lost.
      expect(third).toBeGreaterThan(second);
      expect(third).toBeGreaterThan(first);
    });

    it("rejects corrupt persisted seq and falls back to skip-ahead from 0", () => {
      const storage = new InMemoryStorage();
      storage.setItem("decks_sync_seq", "not-a-number");
      const s = new DeviceLocalState(storage);
      expect(s.takeSeq()).toBe(100);
    });
  });

  describe("HLC state", () => {
    it("starts at pt=0, lc=0 on a fresh device", () => {
      const s = new DeviceLocalState(new InMemoryStorage());
      const state = s.getHlcState();
      expect(state.pt).toBe(0);
      expect(state.lc).toBe(0);
    });

    it("returns a mutable reference; callers can update in place", () => {
      const s = new DeviceLocalState(new InMemoryStorage());
      const state = s.getHlcState();
      state.pt = 1234;
      state.lc = 5;
      expect(s.getHlcState().pt).toBe(1234);
      expect(s.getHlcState().lc).toBe(5);
    });

    it("persistHlc round-trips through storage", () => {
      const storage = new InMemoryStorage();
      const a = new DeviceLocalState(storage);
      const state = a.getHlcState();
      state.pt = 999;
      state.lc = 7;
      a.persistHlc();

      const b = new DeviceLocalState(storage);
      expect(b.getHlcState()).toEqual({ pt: 999, lc: 7 });
    });

    it("falls back to defaults on corrupt persisted HLC", () => {
      const storage = new InMemoryStorage();
      storage.setItem("decks_hlc_state", "{not valid json");
      const s = new DeviceLocalState(storage);
      expect(s.getHlcState()).toEqual({ pt: 0, lc: 0 });
    });
  });

  describe("localStorage wipe scenario (iOS WebKit eviction)", () => {
    it("regenerates fresh deviceId + seq counter without throwing", () => {
      const storage = new InMemoryStorage();
      const before = new DeviceLocalState(storage);
      const beforeId = before.getDeviceId();
      before.takeSeq();

      // Simulate WKWebView clearing site data.
      before.clearForTests();

      const after = new DeviceLocalState(storage);
      expect(after.getDeviceId()).not.toBe(beforeId);
      expect(after.takeSeq()).toBe(100);
    });
  });
});
