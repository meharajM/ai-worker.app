import { Page } from 'playwright-core';

/**
 * Generates a Bézier curve path between two points for human-like mouse movement.
 * Uses two random control points to create natural-looking arcs.
 */
function generateBezierPath(
    start: { x: number; y: number },
    end: { x: number; y: number },
    steps: number
): Array<{ x: number; y: number }> {
    // Two random control points offset from the straight line
    const cp1 = {
        x: start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * 80,
        y: start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * 80
    };
    const cp2 = {
        x: start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * 80,
        y: start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * 80
    };

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        points.push({
            x: Math.max(0, u ** 3 * start.x + 3 * u ** 2 * t * cp1.x + 3 * u * t ** 2 * cp2.x + t ** 3 * end.x),
            y: Math.max(0, u ** 3 * start.y + 3 * u ** 2 * t * cp1.y + 3 * u * t ** 2 * cp2.y + t ** 3 * end.y)
        });
    }
    return points;
}

/**
 * Moves the mouse along a human-like Bézier curve to the target coordinates,
 * then clicks. Uses only native Playwright APIs — no CDP, no Puppeteer.
 */
export async function humanizedClick(page: Page, selector: string): Promise<void> {
    const el = page.locator(selector).first();
    const box = await el.boundingBox();
    if (!box) throw new Error(`Element not visible for selector: ${selector}`);

    // Pick a random point inside the element (avoid exact center)
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    // Move mouse along a curve
    const start = { x: Math.random() * 200, y: Math.random() * 200 };
    const steps = 15 + Math.floor(Math.random() * 10);
    const path = generateBezierPath(start, { x: targetX, y: targetY }, steps);

    for (const point of path) {
        await page.mouse.move(point.x, point.y);
        // Tiny random delay between moves (1-4ms) to avoid looking robotic
        await new Promise((r) => setTimeout(r, 1 + Math.random() * 3));
    }

    // Small hesitation before click (human reaction time)
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));

    await page.mouse.click(targetX, targetY);
}
