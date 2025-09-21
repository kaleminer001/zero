// zerads_captcha_loop.js
// Fully robust: load page -> find captcha -> save -> API -> click -> handle reward/errors with network idle

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

(async () => {
  const START_URL = "https://zerads.com/ptc.php?ref=1&user=gurusingh";
  const API_ENDPOINT = "https://kaleminer001-zeroai.hf.space/match";
  const ITERATION_DELAY_MS = 5000;
  const CLICK_NAV_TIMEOUT = 15000;

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  try {
    const page = await browser.newPage();

    console.log("🌍 Opening start URL:", START_URL);
    await page.goto(START_URL, { waitUntil: "networkidle2", timeout: 60000 });

    console.log("🔁 Starting captcha->API->click loop (ctrl+c to stop)...");

    let iteration = 0;
    while (true) {
      iteration++;
      console.log(`\n--- Iteration ${iteration} ---`);

      await sleep(800);

      // 1️⃣ Find captcha image and check if fully loaded
      const imgInfo = await page.evaluate(async () => {
        const img =
          document.querySelector('img[src*="capstart.php"]') ||
          document.querySelector('img[src*="captcha.php"]');

        if (!img) return { found: false };

        if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
          return { found: false, error: "Image not fully loaded or invalid" };
        }

        const resolved = new URL(img.getAttribute("src"), window.location.href).href;
        const r = await fetch(resolved, { redirect: "follow" });
        if (!r.ok) return { found: false, error: `Fetch failed: ${r.status}` };

        const blob = await r.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const u8 = new Uint8Array(arrayBuffer);
        const bufferArr = Array.from(u8);

        let id = null;
        try {
          const u = new URL(resolved);
          id = u.searchParams.get("id") || u.searchParams.get("image") || u.searchParams.get("file") || null;
        } catch (e) {
          id = null;
        }
        if (!id) id = Date.now().toString();

        return {
          found: true,
          url: resolved,
          filename: `captcha_${id}.jpg`,
          buffer: bufferArr,
        };
      });

      // 1a️⃣ Handle invalid or unloaded image
      if (!imgInfo || !imgInfo.found) {
        if (imgInfo && imgInfo.error) console.warn("⚠️ Image error:", imgInfo.error);
        else console.log("ℹ️ No captcha image found or invalid image.");

        console.log("🌍 Redirecting to start URL to reload captcha...");
        try {
          await page.goto(START_URL, { waitUntil: "networkidle2", timeout: 60000 });
          console.log("⏳ Waiting for captcha image to load...");
          await sleep(1500);
        } catch (e) {
          console.error("❌ Page redirect failed:", e.message);
          break;
        }
        continue; // restart loop after redirect
      }

      // 2️⃣ Save image
      const outPath = path.resolve(process.cwd(), imgInfo.filename);
      try {
        fs.writeFileSync(outPath, Buffer.from(imgInfo.buffer));
        console.log("📸 Saved captcha image:", outPath);
      } catch (e) {
        console.error("❌ Failed to write image file:", e.message);
        continue;
      }

      // 3️⃣ Send image to API
      let bestMatch;
      try {
        console.log("📡 Sending image to API:", API_ENDPOINT);
        const cmd = `curl -s -X POST -F "image=@${outPath}" ${API_ENDPOINT}`;
        const raw = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
        if (!raw) {
          console.warn("⚠️ Empty response from API. Restarting iteration...");
          continue;
        }
        console.log("🔍 API Result:", raw);

        const parsed = JSON.parse(raw);
        bestMatch = parsed.best_match;
        if (!bestMatch) {
          console.warn("⚠️ API did not return best_match. Restarting iteration...");
          continue;
        }
      } catch (err) {
        console.error("❌ API request or parsing failed:", err.message);
        continue;
      }

      // 4️⃣ Click matching captcha link
      const selector = `a > img[src$="${bestMatch}.jpg"]`;
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        await Promise.allSettled([
          page.evaluate((sel) => {
            const img = document.querySelector(sel);
            if (img && img.parentElement) img.parentElement.click();
          }, selector),
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: CLICK_NAV_TIMEOUT }).catch(() => null),
        ]);

        console.log(`✅ Clicked matching link for best_match=${bestMatch}`);
        console.log("⏱ Waiting 10 seconds before next iteration...");
        await sleep(10000); // 10 sec delay
      } catch (e) {
        console.error("❌ Matching link/image not found or click failed:", e.message);
        continue;
      }

      // 5️⃣ Check for "Wrong Captcha"
      try {
        const wrongCaptcha = await page.evaluate(() => {
          const bodyText = document.body.innerText || "";
          return bodyText.includes("Wrong Captcha");
        });
        if (wrongCaptcha) {
          console.warn("⚠️ Wrong Captcha detected! Restarting iteration...");
          continue; // restart loop
        }
      } catch (e) {
        console.warn("⚠️ Failed to check Wrong Captcha:", e.message);
      }

      // 6️⃣ Extract reward
      try {
        const reward = await page.evaluate(() => {
          const greenFont = document.querySelector("center font[color='green']");
          return greenFont ? greenFont.textContent.trim() : null;
        });
        if (reward) console.log(`💰 Reward received: ${reward}`);
        else console.log("ℹ️ No reward detected this iteration.");
      } catch (e) {
        console.warn("⚠️ Failed to extract reward:", e.message);
      }

      // 7️⃣ Delete local image
      try { fs.unlinkSync(outPath); } catch (e) {}

      await sleep(ITERATION_DELAY_MS);
    }

  } catch (err) {
    console.error("❌ Fatal error:", err);
  } finally {
    await browser.close();
  }
})();
