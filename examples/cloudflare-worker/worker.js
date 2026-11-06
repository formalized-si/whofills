/**
 * Puts whofills in front of any site with no backend change: injects the script, checks POSTs to protected paths,
 * and re-posts held submissions after the person passes. Needs the `nodejs_compat` flag.
 *   WHOFILLS_SECRET  a long random string (wrangler secret)
 */
import { createGuard } from "whofills/server";
import client from "whofills/whofills.js";
import hold from "whofills/hold.js";

const PROTECTED = [/^\/apply\b/]; // paths whose form POSTs are checked
const SELECTOR = "form"; // forms to protect on those pages

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const guard = createGuard({ secret: env.WHOFILLS_SECRET, mode: env.WHOFILLS_MODE ?? "tag" });
    if (url.pathname === "/whofills.js") return new Response(client, { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/__wf/hold.js") return new Response(hold, { headers: { "content-type": "text/javascript" } });

    const guarded = PROTECTED.some((re) => re.test(url.pathname));
    if (guarded && request.method === "POST" && (request.headers.get("content-type") ?? "").includes("urlencoded")) {
      const result = await guard.fetch(request);
      if ("response" in result) return result.response;
      const headers = new Headers(request.headers);
      headers.set("x-agent-verdict", result.verdict?.verdict ?? "none");
      return fetch(new Request(request.url, { method: "POST", headers, body: new URLSearchParams(result.fields) }));
    }

    const response = await fetch(request);
    if (!guarded || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
    return new HTMLRewriter()
      .on("body", {
        element: (el) =>
          el.append(`<script src="/whofills.js" defer data-protect="${SELECTOR}" data-attest="gate"></script>`, {
            html: true,
          }),
      })
      .transform(response);
  },
};
