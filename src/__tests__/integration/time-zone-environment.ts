import { TestEnvironment } from "jest-environment-node";

// A test file's own process.env is a copy, so the zone is set here, on the worker, and restored after.
// The zone comes from @jest-environment-options {"timezone": "..."}; Europe/Berlin by default.
export default class TimeZoneEnvironment extends TestEnvironment {
  private readonly wanted: string;
  private zone: string | undefined;

  constructor(...args: ConstructorParameters<typeof TestEnvironment>) {
    super(...args);
    const timezone = args[0].projectConfig.testEnvironmentOptions.timezone;
    this.wanted = typeof timezone === "string" ? timezone : "Europe/Berlin";
  }

  async setup(): Promise<void> {
    this.zone = process.env.TZ;
    process.env.TZ = this.wanted;
    await super.setup();
  }

  async teardown(): Promise<void> {
    if (this.zone === undefined) delete process.env.TZ;
    else process.env.TZ = this.zone;
    await super.teardown();
  }
}
