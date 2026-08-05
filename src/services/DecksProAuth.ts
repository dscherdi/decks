import { requestUrl } from "obsidian";
import { DECKS_PRO_DEFAULT_BASE_URL, DECKS_PRO_SITE_URL } from "@decks/core";
import type { AiKeyStore } from "./AiKeyStore";
import type { Logger } from "../utils/logging";

/** Tokens minted by sign-in carry this prefix; anything else is a license key. */
const DEVICE_TOKEN_PREFIX = "dk_";

export interface ProDevice {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface ProSubscription {
  status: string;
  renews_at: string | null;
  ends_at: string | null;
  customer_portal_url: string | null;
  update_payment_url: string | null;
}

export interface ProAccount {
  user: { id: string | null; email: string | null };
  entitled: boolean;
  subscription: ProSubscription | null;
  trial: { on_trial: boolean; exhausted: boolean };
  devices: ProDevice[];
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decks Pro sign-in for the plugin.
 *
 * Signing in performs a browser round-trip: the plugin opens the website with a
 * one-time `state` nonce, the site hands back a single-use code through
 * `obsidian://decks-auth`, and that code is exchanged here for a long-lived
 * device token.
 *
 * The token is kept in the existing AiKeyStore slot for the `decks-pro`
 * provider, so it rides the same non-synced file as the other provider
 * credentials and every call site that already builds a provider config keeps
 * working unchanged. A manually pasted license key uses the same slot — the
 * backend tells the two apart by the token prefix.
 */
export class DecksProAuth {
  private pendingState: string | null = null;

  constructor(
    private readonly keyStore: AiKeyStore,
    /** Development overrides; blank falls back to the hosted defaults. */
    private readonly urls: () => {
      proBaseUrl?: string;
      proSiteUrl?: string;
      deviceId?: string;
    },
    private readonly logger?: Logger,
    /** Persists a newly minted device id. Without it the id is per-session. */
    private readonly persist?: () => Promise<void>,
  ) {}

  // Overrides are honoured only in development builds, so a value left in
  // data.json by a dev build can never redirect a release install.
  private get base(): string {
    const override = __DECKS_DEV__ ? this.urls().proBaseUrl?.trim() : "";
    return (override || DECKS_PRO_DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private get site(): string {
    const override = __DECKS_DEV__ ? this.urls().proSiteUrl?.trim() : "";
    return (override || DECKS_PRO_SITE_URL).replace(/\/+$/, "");
  }

  /** The stored device token, or "". */
  async getCredential(): Promise<string> {
    return (await this.keyStore.get("decks-pro")).trim();
  }

  /** True only for a credential obtained by signing in. */
  async isSignedIn(): Promise<boolean> {
    return (await this.getCredential()).startsWith(DEVICE_TOKEN_PREFIX);
  }

  /**
   * Stable id for this install, minted once and kept across sign-outs so the
   * backend can tell a re-link from a genuinely new device.
   */
  private deviceId(): string {
    const settings = this.urls();
    const existing = settings.deviceId?.trim();
    if (existing) return existing;
    const id = randomState();
    settings.deviceId = id;
    void this.persist?.();
    return id;
  }

  /** Open the website's link page with a fresh nonce for this attempt. */
  startSignIn(vaultName: string): void {
    this.pendingState = randomState();
    const url = new URL(`${this.site}/link`);
    url.searchParams.set("state", this.pendingState);
    if (vaultName) url.searchParams.set("vault", vaultName);
    url.searchParams.set("device", this.deviceId());
    window.open(url.toString(), "_blank");
  }

  /**
   * Handle the obsidian://decks-auth callback. A mismatched nonce is rejected,
   * so only a hand-off this plugin instance started can complete, and the nonce
   * is cleared either way to make it single-use.
   */
  async completeSignIn(params: { state?: string; code?: string }): Promise<boolean> {
    const expected = this.pendingState;
    this.pendingState = null;

    if (!expected || !params.state || params.state !== expected) {
      this.logger?.debug("Decks Pro sign-in rejected: unexpected state");
      return false;
    }
    if (!params.code) return false;

    try {
      const res = await requestUrl({
        url: `${this.base}/api/auth/exchange`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: params.code }),
        throw: false,
      });
      if (res.status !== 200) {
        this.logger?.debug(`Decks Pro code exchange failed: ${res.status}`);
        return false;
      }
      const data = res.json as { token?: string };
      if (typeof data?.token !== "string" || !data.token) return false;

      await this.keyStore.set("decks-pro", data.token);
      return true;
    } catch (e) {
      this.logger?.debug(`Decks Pro code exchange error: ${String(e)}`);
      return false;
    }
  }

  /** Forget the local credential. The device stays listed on the website. */
  async signOut(): Promise<void> {
    await this.keyStore.set("decks-pro", "");
  }

  /** Subscription, quota, and linked devices for the stored credential. */
  async fetchAccount(): Promise<ProAccount | null> {
    const credential = await this.getCredential();
    if (!credential) return null;
    try {
      const res = await requestUrl({
        url: `${this.base}/api/me`,
        method: "GET",
        headers: { Authorization: `Bearer ${credential}` },
        throw: false,
      });
      if (res.status === 401 && credential.startsWith(DEVICE_TOKEN_PREFIX)) {
        // Only drop the credential when the backend says this device is gone.
        // Every other 401 (a transient failure, or a backend that doesn't know
        // this credential yet) must leave it alone, or a blip signs the user out.
        const code = (res.json as { code?: string } | undefined)?.code;
        if (code === "device_revoked") {
          await this.signOut();
        }
        return null;
      }
      if (res.status !== 200) return null;
      return res.json as ProAccount;
    } catch (e) {
      this.logger?.debug(`Failed to fetch Decks Pro account: ${String(e)}`);
      return null;
    }
  }

  accountUrl(): string {
    return `${this.site}/account`;
  }

  pricingUrl(): string {
    return `${this.site}/pricing`;
  }
}
