// Finds a player's own contact details on a public page a coach linked (many
// recruits list an email, phone or X handle on their profile so coaches can
// reach them). Conservative by design: the site's own addresses and generic
// inboxes are ignored, and if a page lists several candidates (likely a team
// or directory page, not the player's own) nothing is suggested.
// Suggestions always go to the coach for approval; nothing is saved silently.

import { parse } from "node-html-parser";
import { normalizePhone, normalizeXHandle } from "../repo";

export interface ContactSuggestion {
  email: string | null;
  phone: string | null;
  xHandle: string | null;
}

const GENERIC = /^(info|support|help|contact|admin|noreply|no-reply|donotreply|privacy|legal|press|media|sales|webmaster|team|office|hello|feedback|abuse|jobs|careers|athletics|sports|baseball)$/i;
const SITE_HANDLES = /^(maxpreps|perfectgame|perfect_game|pbr|prepbaseball|prepbaseballreport|hudl|ncsa|fieldlevel|twitter|x|home|intent|share|search|i)$/i;

export function extractContactInfo(html: string, pageUrl: string): ContactSuggestion {
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const siteRoot = host.split(".").slice(-2).join(".");
  const root = parse(html);
  const text = root.text.replace(/\s+/g, " ");

  const emails = new Set<string>();
  for (const a of root.querySelectorAll('a[href^="mailto:"]')) emails.add(a.getAttribute("href")!.slice(7).split("?")[0].trim().toLowerCase());
  for (const m of text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) emails.add(m[0].toLowerCase());
  const goodEmails = [...emails].filter((e) => {
    const [local, domain] = e.split("@");
    return domain && !domain.endsWith(siteRoot) && !GENERIC.test(local) && !/\.(png|jpe?g|gif|svg|webp)$/.test(e) && !/example\.(com|org)$/.test(domain);
  });

  const phones = new Set<string>();
  for (const a of root.querySelectorAll('a[href^="tel:"], a[href^="sms:"]')) {
    const p = normalizePhone(a.getAttribute("href")!.replace(/^(tel|sms):/, ""));
    if (p) phones.add(p);
  }
  // Text numbers only when labeled as the player's phone/cell.
  for (const m of text.matchAll(/\b(?:cell|phone|mobile|text|call)\s*(?:#|number|no\.?)?\s*[:\-]?\s*(\+?1?[\s.\-]?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/gi)) {
    const p = normalizePhone(m[1]);
    if (p) phones.add(p);
  }

  const handles = new Set<string>();
  for (const a of root.querySelectorAll('a[href*="twitter.com/"], a[href*="x.com/"]')) {
    const h = normalizeXHandle(a.getAttribute("href")!.split("?")[0].replace(/\/$/, ""));
    if (h && !SITE_HANDLES.test(h) && !h.toLowerCase().includes(siteRoot.split(".")[0])) handles.add(h);
  }

  return {
    email: goodEmails.length === 1 ? goodEmails[0] : null,
    phone: phones.size === 1 ? [...phones][0] : null,
    xHandle: handles.size === 1 ? [...handles][0] : null,
  };
}
