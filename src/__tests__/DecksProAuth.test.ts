import { setRequestUrlHandler } from "obsidian";
import type { DataAdapter } from "obsidian";
import { AiKeyStore } from "../services/AiKeyStore";
import { DecksProAuth } from "../services/DecksProAuth";

/** In-memory DataAdapter covering only what AiKeyStore touches. */
function fakeAdapter(): DataAdapter {
  const files = new Map<string, string>();
  return {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => files.get(path) ?? "",
    write: async (path: string, data: string) => void files.set(path, data),
  } as unknown as DataAdapter;
}

interface OpenedUrl {
  url: string;
}

function setup(
  urls: { proBaseUrl?: string; proSiteUrl?: string; deviceId?: string } = {},
  persist?: () => Promise<void>,
) {
  const keyStore = new AiKeyStore(fakeAdapter(), "plugins/decks");
  const auth = new DecksProAuth(keyStore, () => urls, undefined, persist);
  const opened: OpenedUrl[] = [];
  (globalThis as unknown as { window: { open: (u: string) => void } }).window = {
    open: (url: string) => void opened.push({ url }),
  };
  return { auth, keyStore, opened };
}

/** Pull the nonce out of the URL the plugin opened in the browser. */
function stateFrom(url: string): string {
  return new URL(url).searchParams.get("state") ?? "";
}

beforeEach(() => {
  setRequestUrlHandler(async () => ({ status: 500, text: "", json: null }));
});

describe("DecksProAuth sign-in hand-off", () => {
  it("opens the link page with a nonce and the vault name", () => {
    const { auth, opened } = setup();
    auth.startSignIn("My Vault");

    expect(opened).toHaveLength(1);
    const url = new URL(opened[0].url);
    expect(url.pathname).toBe("/link");
    expect(url.searchParams.get("vault")).toBe("My Vault");
    expect(stateFrom(opened[0].url)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("uses a different nonce on every attempt", () => {
    const { auth, opened } = setup();
    auth.startSignIn("v");
    auth.startSignIn("v");
    expect(stateFrom(opened[0].url)).not.toBe(stateFrom(opened[1].url));
  });

  it("stores the device token when the state matches", async () => {
    const { auth, keyStore, opened } = setup();
    setRequestUrlHandler(async () => ({
      status: 200,
      text: "",
      json: { token: "dk_realtoken", user_id: "u1" },
    }));

    auth.startSignIn("v");
    const ok = await auth.completeSignIn({ state: stateFrom(opened[0].url), code: "dlc_x" });

    expect(ok).toBe(true);
    expect(await keyStore.get("decks-pro")).toBe("dk_realtoken");
    expect(await auth.isSignedIn()).toBe(true);
  });

  it("rejects a callback whose state does not match", async () => {
    const { auth, keyStore } = setup();
    setRequestUrlHandler(async () => ({
      status: 200,
      text: "",
      json: { token: "dk_attacker" },
    }));

    auth.startSignIn("v");
    const ok = await auth.completeSignIn({ state: "not-the-nonce", code: "dlc_x" });

    expect(ok).toBe(false);
    expect(await keyStore.get("decks-pro")).toBe("");
  });

  it("rejects a callback that arrives with no sign-in in flight", async () => {
    const { auth } = setup();
    const ok = await auth.completeSignIn({ state: "anything", code: "dlc_x" });
    expect(ok).toBe(false);
  });

  it("burns the nonce so a replayed callback fails", async () => {
    const { auth, opened } = setup();
    setRequestUrlHandler(async () => ({ status: 200, text: "", json: { token: "dk_t" } }));

    auth.startSignIn("v");
    const state = stateFrom(opened[0].url);
    expect(await auth.completeSignIn({ state, code: "dlc_x" })).toBe(true);
    expect(await auth.completeSignIn({ state, code: "dlc_x" })).toBe(false);
  });

  it("does not store anything when the exchange fails", async () => {
    const { auth, keyStore, opened } = setup();
    setRequestUrlHandler(async () => ({ status: 401, text: "", json: null }));

    auth.startSignIn("v");
    const ok = await auth.completeSignIn({ state: stateFrom(opened[0].url), code: "dlc_dead" });

    expect(ok).toBe(false);
    expect(await keyStore.get("decks-pro")).toBe("");
  });

  it("requires a code alongside a valid state", async () => {
    const { auth, opened } = setup();
    auth.startSignIn("v");
    expect(await auth.completeSignIn({ state: stateFrom(opened[0].url) })).toBe(false);
  });
});

describe("DecksProAuth credential kinds", () => {
  it("treats a dk_ credential as signed in", async () => {
    const { auth, keyStore } = setup();
    await keyStore.set("decks-pro", "dk_token");
    expect(await auth.isSignedIn()).toBe(true);
  });

  it("is signed out when nothing is stored", async () => {
    const { auth } = setup();
    expect(await auth.isSignedIn()).toBe(false);
  });

  it("clears the credential on sign-out", async () => {
    const { auth, keyStore } = setup();
    await keyStore.set("decks-pro", "dk_token");
    await auth.signOut();
    expect(await keyStore.get("decks-pro")).toBe("");
    expect(await auth.isSignedIn()).toBe(false);
  });
});

describe("DecksProAuth account", () => {
  it("sends the stored credential as a bearer token", async () => {
    const { auth, keyStore } = setup();
    await keyStore.set("decks-pro", "dk_token");
    let seen: Record<string, string> | undefined;
    setRequestUrlHandler(async (options) => {
      seen = options.headers;
      return { status: 200, text: "", json: { user: { id: "u1", email: "a@b.com" } } };
    });

    const account = await auth.fetchAccount();
    expect(seen?.Authorization).toBe("Bearer dk_token");
    expect(account?.user.email).toBe("a@b.com");
  });

  it("returns null without calling the network when signed out", async () => {
    const { auth } = setup();
    let called = false;
    setRequestUrlHandler(async () => {
      called = true;
      return { status: 200, text: "", json: {} };
    });

    expect(await auth.fetchAccount()).toBeNull();
    expect(called).toBe(false);
  });

  it("drops a device token the backend says is revoked", async () => {
    const { auth, keyStore } = setup();
    await keyStore.set("decks-pro", "dk_revoked");
    setRequestUrlHandler(async () => ({
      status: 401,
      text: "",
      json: { code: "device_revoked" },
    }));

    expect(await auth.fetchAccount()).toBeNull();
    expect(await keyStore.get("decks-pro")).toBe("");
  });

  // A 401 without that signal means "this backend can't verify you right now" —
  // a rebuilt dev database, a different backend, a blip. Discarding the
  // credential there silently signs the user out of a working install.
  it("keeps the credential on a 401 that is not a revocation", async () => {
    const { auth, keyStore } = setup();
    await keyStore.set("decks-pro", "dk_still_good");
    setRequestUrlHandler(async () => ({
      status: 401,
      text: "",
      json: { code: "invalid_credentials" },
    }));

    expect(await auth.fetchAccount()).toBeNull();
    expect(await keyStore.get("decks-pro")).toBe("dk_still_good");
  });

  it("keeps the credential when a 401 carries no body at all", async () => {
    const { auth, keyStore } = setup();
    await keyStore.set("decks-pro", "dk_still_good");
    setRequestUrlHandler(async () => ({ status: 401, text: "", json: null }));

    expect(await auth.fetchAccount()).toBeNull();
    expect(await keyStore.get("decks-pro")).toBe("dk_still_good");
  });
});

describe("DecksProAuth device identity", () => {
  it("sends a device id with the hand-off and reuses it across sign-ins", () => {
    const settings: { proSiteUrl?: string; deviceId?: string } = {
      proSiteUrl: "http://localhost:4321",
    };
    const { auth, opened } = setup(settings);

    auth.startSignIn("v");
    const first = new URL(opened[0].url).searchParams.get("device");
    expect(first).toBeTruthy();
    expect(settings.deviceId).toBe(first);

    auth.startSignIn("v");
    expect(new URL(opened[1].url).searchParams.get("device")).toBe(first);
  });

  it("persists a newly minted id so it survives a restart", () => {
    const settings: { deviceId?: string } = {};
    let persisted = 0;
    const { auth } = setup(settings, async () => {
      persisted += 1;
    });

    auth.startSignIn("v");
    auth.startSignIn("v");
    expect(persisted).toBe(1);
  });
});

describe("DecksProAuth development overrides", () => {
  it("uses the hosted defaults when no override is set", () => {
    const { auth, opened } = setup();
    auth.startSignIn("v");
    expect(new URL(opened[0].url).origin).toBe("https://decksmd.app");
    expect(auth.accountUrl()).toBe("https://decksmd.app/account");
  });

  it("points the browser hand-off at an overridden site", () => {
    const { auth, opened } = setup({ proSiteUrl: "http://localhost:4321" });
    auth.startSignIn("v");

    const url = new URL(opened[0].url);
    expect(url.origin).toBe("http://localhost:4321");
    expect(url.pathname).toBe("/link");
    expect(auth.accountUrl()).toBe("http://localhost:4321/account");
    expect(auth.pricingUrl()).toBe("http://localhost:4321/pricing");
  });

  it("posts the code exchange to an overridden worker", async () => {
    const { auth, opened } = setup({ proBaseUrl: "http://localhost:8787/" });
    let seen = "";
    setRequestUrlHandler(async (options) => {
      seen = options.url;
      return { status: 200, text: "", json: { token: "dk_t" } };
    });

    auth.startSignIn("v");
    await auth.completeSignIn({ state: stateFrom(opened[0].url), code: "dlc_x" });

    // Trailing slash trimmed so the path is not doubled up.
    expect(seen).toBe("http://localhost:8787/api/auth/exchange");
  });

  it("ignores a blank override rather than building an invalid URL", () => {
    const { auth, opened } = setup({ proSiteUrl: "   " });
    auth.startSignIn("v");
    expect(new URL(opened[0].url).origin).toBe("https://decksmd.app");
  });
});
