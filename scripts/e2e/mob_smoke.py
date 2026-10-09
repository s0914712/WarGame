"""MOB drift end-to-end smoke test (headless Chromium).

ASCII-only on purpose: every selector is a data-testid, never Chinese UI text,
so it works from a Windows cp950 console / PowerShell without encoding setup.

    npx vite --port 5173            # dev server (window.__wgMap is DEV-only)
    python scripts/e2e/mob_smoke.py [--url http://localhost:5173] [--out shots] [--lng 119.4 --lat 23.4]

Steps: landing -> campaign -> first scenario -> start -> briefing start ->
search planner -> "mark MOB" -> click lng/lat on map -> wait for drift ->
step 1 (area from particles) -> step 3 (generate tracks). Exits non-zero on failure.
"""
import argparse
import os
import sys

from playwright.sync_api import sync_playwright


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173")
    ap.add_argument("--out", default="")
    ap.add_argument("--lng", type=float, default=119.4)   # open water, southern Taiwan Strait
    ap.add_argument("--lat", type=float, default=23.4)
    ap.add_argument("--timeout", type=int, default=60, help="seconds to wait for drift")
    a = ap.parse_args()
    if a.out:
        os.makedirs(a.out, exist_ok=True)

    def shot(pg, name):
        if a.out:
            pg.screenshot(path=os.path.join(a.out, name))

    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        # reduced motion: the landing screen's entry / glow animations otherwise keep elements
        # "not stable" for Playwright under software GL (styles.css honours prefers-reduced-motion)
        pg = b.new_page(viewport={"width": 1600, "height": 950}, reduced_motion="reduce")
        pg.on("pageerror", lambda e: errors.append(str(e)))
        tid = lambda t: pg.locator(f'[data-testid="{t}"]')

        pg.goto(f"{a.url}/?mode=wargame")
        tid("landing-menu-campaign").click()
        pg.locator('[data-testid^="landing-scenario-"]').first.click()
        tid("landing-start").click()
        tid("briefing-start").click()
        # Don't gate on loaded()/isStyleLoaded(): wargame layers setData every tick and tiles keep
        # streaming under software GL, so both flicker. project() only needs a style + camera at rest.
        pg.wait_for_function("() => { const m = window.__wgMap; return !!m && !!m.getStyle() && !m.isMoving(); }",
                             polling=250, timeout=30000)
        pg.wait_for_timeout(500)
        print("[ok] scenario loaded")

        tid("topbar-search").click()
        tid("mob-pick").click()
        # lng/lat -> screen pixel via the live map (no pixel guessing)
        xy = pg.evaluate("([lng, lat]) => { const p = window.__wgMap.project([lng, lat]);"
                         " const r = window.__wgMap.getCanvas().getBoundingClientRect();"
                         " return [r.left + p.x, r.top + p.y]; }", [a.lng, a.lat])
        pg.mouse.click(xy[0], xy[1])
        print(f"[ok] MOB marked at {a.lng},{a.lat} (pixel {xy[0]:.0f},{xy[1]:.0f})")

        tid("mob-stats").wait_for(timeout=a.timeout * 1000)
        stats = tid("mob-stats").inner_text().replace("\n", " | ")
        print("[ok] drift ready:", stats.encode("ascii", "backslashreplace").decode())
        shot(pg, "mob_1_drift.png")

        tid("mob-step-1").click()
        pg.wait_for_selector('[data-testid="mob-step-1"][data-done="1"]', timeout=5000)
        tid("mob-step-3").click()
        pg.wait_for_selector('[data-testid="mob-step-3"][data-done="1"]', timeout=5000)
        print("[ok] search area set and tracks generated")
        shot(pg, "mob_2_tracks.png")
        b.close()

    if errors:
        print("[fail] page errors:", *errors, sep="\n  ")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
