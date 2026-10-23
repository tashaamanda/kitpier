import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const req = (url: string, host: string) => new NextRequest(url, { headers: { host } });
const matcher = new RegExp(`^${config.matcher[0].replace("/((?!", "/(?!").replace(").*)", ").*")}$`);

afterEach(() => {
  process.env.APP_URL = "https://kitpier.com";
});

describe("primary address", () => {
  it("moves the old Render host and www to kitpier.com, keeping path and query", () => {
    process.env.APP_URL = "https://kitpier.com";
    for (const host of ["kitpier.onrender.com", "www.kitpier.com"]) {
      const r = proxy(req(`https://${host}/projects/prj_1?tab=a`, host));
      expect(r.status).toBe(308);
      expect(r.headers.get("location")).toBe("https://kitpier.com/projects/prj_1?tab=a");
    }
  });

  it("leaves the primary host, other hosts, and the pre-switch setup alone", () => {
    process.env.APP_URL = "https://kitpier.com";
    expect(proxy(req("https://kitpier.com/", "kitpier.com")).headers.get("location")).toBeNull();
    expect(proxy(req("http://localhost:3005/", "localhost:3005")).headers.get("location")).toBeNull();
    expect(proxy(req("https://evil.example/", "evil.example")).headers.get("location")).toBeNull();
    process.env.APP_URL = "https://kitpier.onrender.com"; // before the switch: no redirect loop
    expect(proxy(req("https://kitpier.onrender.com/", "kitpier.onrender.com")).headers.get("location")).toBeNull();
  });

  it("never runs on PayPal webhooks or the /v1 API", () => {
    expect(matcher.test("/api/paypal/webhook")).toBe(false);
    expect(matcher.test("/v1/booking/converse")).toBe(false);
    expect(matcher.test("/projects/prj_1")).toBe(true);
    expect(matcher.test("/api/auth/login")).toBe(true);
  });
});
