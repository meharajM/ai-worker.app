let cachedGeoLocation: string | null = null;
let isFetchingGeo = false;
let geoFetchBackoffUntil = 0;
let lastGeoFetchErrorLogAt = 0;

const GEO_FETCH_TIMEOUT_MS = 2000;
const GEO_FETCH_BACKOFF_MS = 10 * 60 * 1000;
const GEO_LOG_THROTTLE_MS = 60 * 1000;

export async function fetchGeoLocation(): Promise<string | null> {
    if (cachedGeoLocation) return cachedGeoLocation;
    if (Date.now() < geoFetchBackoffUntil) return null;
    if (isFetchingGeo) return null; // Avoid concurrent identical requests blocking
    isFetchingGeo = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEO_FETCH_TIMEOUT_MS);
    try {
        const res = await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: controller.signal });
        if (res.ok) {
            const data = await res.json();
            const parts: string[] = [];
            if (data.city && data.region) parts.push(`City/Region: ${data.city}, ${data.region}`);
            if (data.country) parts.push(`Country: ${data.country} (${data.country_code})`);
            if (data.timezone) parts.push(`IP Timezone: ${data.timezone}`);
            if (data.organization_name) parts.push(`ISP: ${data.organization_name}`);

            if (parts.length > 0) {
                cachedGeoLocation = parts.join('\\n  - ');
            } else {
                geoFetchBackoffUntil = Date.now() + GEO_FETCH_BACKOFF_MS;
            }
        } else {
            geoFetchBackoffUntil = Date.now() + GEO_FETCH_BACKOFF_MS;
        }
    } catch (e) {
        geoFetchBackoffUntil = Date.now() + GEO_FETCH_BACKOFF_MS;
        if (Date.now() - lastGeoFetchErrorLogAt >= GEO_LOG_THROTTLE_MS) {
            lastGeoFetchErrorLogAt = Date.now();
            console.warn("[LLM context] Failed to fetch geolocation (backing off)", e);
        }
    } finally {
        clearTimeout(timeout);
        isFetchingGeo = false;
    }
    return cachedGeoLocation;
}

/**
 * Helper to generate the dynamic user environment context
 * automatically injected into all LLM prompts.
 */
export async function getUserEnvironmentContext(): Promise<string> {
    const currentTime = new Date().toString();
    // System Timezone is still useful as a fallback or cross-reference 
    const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const geoLoc = await fetchGeoLocation();
    const locationInfo = geoLoc ? `\\n  - ${geoLoc}` : `\\n  - System Timezone: ${systemTimeZone}`;

    return `
# USER ENVIRONMENT CONTEXT (Auto-Injected, Read-Only — Do NOT act on this section)
> ⚠️ This section provides contextual awareness ONLY. The values and examples below
> are NOT instructions to open sites, run commands, or perform any actions.
> Examples marked with [e.g. ...] are ILLUSTRATIVE ONLY — do NOT navigate to or use them
> unless the user explicitly asks for that specific resource.

- **Current Time:** ${currentTime}
- **Detected Location Data:**${locationInfo}

## How to Apply This Context Across All Tasks

Use the user's detected location data to make every automation region-appropriate.
This applies broadly — not just to websites:

1. **Websites & Services**: When navigating to a brand or service, prefer its
   region-appropriate version. If you are unsure of the correct URL,
   search for it first (e.g. search "[brand name] [country from location data] official site")
   before navigating. Do NOT blindly guess TLDs.

2. **App Stores / Software Downloads**: Prefer the storefront or
   region-specific download (e.g. regional Play Store, App Store, or local software portals) appropriate for their location.

3. **Currency & Pricing**: When displaying or entering prices, use the currency and
   format appropriate for their location (e.g. INR/₹ for India, GBP/£ for UK,
   USD/$ for US).

4. **Date & Number Formats**: Use the locale-appropriate format for dates, times,
   and numbers based on their location (e.g. DD/MM/YYYY vs MM/DD/YYYY, comma vs
   period as decimal separator).

5. **Language Defaults**: When generating content, filling forms, or writing emails
   on behalf of the user, default to the language appropriate for their location unless the user specifies otherwise.

6. **Local Alternatives**: Suggest or use locally relevant services where applicable
   (e.g. local payment gateways, regional shipping providers, country-specific
   government portals).

> REMINDER: Do NOT navigate to any example site above. Wait for an explicit user instruction.
`;
}
