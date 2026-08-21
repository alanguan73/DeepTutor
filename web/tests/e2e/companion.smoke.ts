import { test, expect } from "@playwright/test";

/**
 * Live smoke for /companion — requires DeepTutor + psych-academy companion.
 * Against staging: WEB_BASE_URL=https://jiatingguwen.cn
 * Skip when SKIP_LIVE_SMOKE=1.
 */
const CRISIS_PHRASE = "我想结束自己的生命";
const BENIGN_PHRASE =
  "孩子最近厌学，作业冲突很多，我压力很大，想慢慢聊聊怎么改善亲子沟通。";

test.describe("Companion :: static", () => {
  test("page loads companion shell", async ({ page }) => {
    await page.goto("/companion", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Companion", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("陪聊 Companion")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Interrupt" }),
    ).toBeVisible();
    await expect(page.getByText("显示辅导进度")).toBeVisible();
  });
});

test.describe("Companion :: live smoke", () => {
  test.skip(
    !!process.env.SKIP_LIVE_SMOKE,
    "SKIP_LIVE_SMOKE set — skipping live companion browser test",
  );

  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/companion", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          !text.includes("Connecting…") &&
          !text.includes("Reconnecting…") &&
          text.includes("陪聊 Companion")
        );
      },
      { timeout: 45_000 },
    );
  });

  test("crisis message shows banner and locks composer", async ({ page }) => {
    const textarea = page.getByRole("textbox", { name: "Companion message" });
    await expect(textarea).toBeEnabled({ timeout: 5_000 });

    await textarea.fill(CRISIS_PHRASE);
    await page.getByRole("button", { name: "Send" }).click();

    // Prefer the crisis banner; also accept referral copy if host streamed content first.
    const banner = page.getByRole("status");
    await expect
      .poll(
        async () => {
          const statusVisible = await banner
            .filter({ hasText: /Crisis redirect detected/i })
            .count();
          if (statusVisible > 0) return "banner";
          const body = await page.locator("body").innerText();
          if (/Permission denied/i.test(body)) return "perm";
          if (/紧急服务|危机|不能做危机干预|Crisis redirect/i.test(body)) {
            return "referral";
          }
          return "waiting";
        },
        { timeout: 90_000 },
      )
      .not.toBe("perm");

    await expect
      .poll(
        async () => {
          const statusVisible = await banner
            .filter({ hasText: /Crisis redirect detected/i })
            .count();
          if (statusVisible > 0) return true;
          const body = await page.locator("body").innerText();
          return /紧急服务|不能做危机干预|Crisis redirect detected/i.test(body);
        },
        { timeout: 90_000 },
      )
      .toBe(true);

    await expect(textarea).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("interrupt cancels in-flight turn and unlocks composer", async ({
    page,
  }) => {
    const textarea = page.getByRole("textbox", { name: "Companion message" });
    const interrupt = page.getByRole("button", { name: "Interrupt" });
    const send = page.getByRole("button", { name: "Send" });

    await expect(textarea).toBeEnabled({ timeout: 5_000 });
    await expect(interrupt).toBeDisabled();

    await textarea.fill(BENIGN_PHRASE);
    await send.click();

    // Turn started: Interrupt becomes enabled while busy.
    await expect(interrupt).toBeEnabled({ timeout: 45_000 });
    await interrupt.click();

    // After cancel, Interrupt disables and composer accepts input again.
    await expect(interrupt).toBeDisabled({ timeout: 15_000 });
    await expect(textarea).toBeEnabled();

    await textarea.fill("刚才打断了，我们继续：孩子大概初二。");
    await expect(send).toBeEnabled();
    await send.click();

    await expect(
      page.getByText("刚才打断了，我们继续：孩子大概初二。"),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Connection failed", {
      timeout: 15_000,
    });
    // Follow-up turn should eventually leave busy state.
    await expect(interrupt).toBeDisabled({ timeout: 120_000 });
  });

  test("progress toggle is off by default and can be enabled", async ({
    page,
  }) => {
    const toggle = page.getByLabel("显示辅导进度");
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await expect(
      page.getByText("Progress will appear after the next reply.").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
