/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

/**
 * Feedback Lens (Cloudflare Workers + KV + Workers AI)
 */

export interface Env {
  FEEDBACK_KV: KVNamespace;
  AI: Ai;
}

type AnalysisJSON = {
  summary?: string;
  sentiment?: "positive" | "neutral" | "negative";
  themes?: string[];
  urgency?: "low" | "medium" | "high";
};

function parseMaybeJSON(s: unknown): AnalysisJSON | null {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "POST") {
      const body = (await request.json()) as { text?: string };
      const text = (body.text ?? "").trim();

      if (!text) {
        return new Response(JSON.stringify({ error: "Missing text" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const key = `feedback:${Date.now()}`;
      await env.FEEDBACK_KV.put(key, text);

      // Workers AI (LLM) — cast avoids TS model-id mismatch
      const analysis = await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct" as any,
        {
          messages: [
            {
              role: "system",
              content:
                "You are a product manager assistant. Return ONLY valid JSON with keys: summary (1-2 sentences), sentiment (positive|neutral|negative), themes (array of 3 short phrases), urgency (low|medium|high). No extra keys.",
            },
            { role: "user", content: text },
          ],
        }
      );

      // Some models return { response: "json-string" } — normalize here
      const responseText =
        (analysis as any)?.response ??
        (analysis as any)?.result ??
        (analysis as any)?.output ??
        null;

      const parsed = parseMaybeJSON(responseText);

      return new Response(
        JSON.stringify(
          {
            status: "saved",
            key,
            stored: true,
            raw: analysis,
            parsed: parsed ?? null,
          },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Feedback Lens</title>
  </head>
  <body style="margin:0; background:#0b0f17; color:#e8eefc; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;">
    <div style="max-width:980px; margin:0 auto; padding:48px 20px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
        <div>
          <div style="display:inline-block; padding:6px 10px; border:1px solid rgba(255,255,255,.14); border-radius:999px; font-size:12px; color:#c7d2fe; background:rgba(255,255,255,.04);">
            Cloudflare Workers • KV • Workers AI
          </div>
          <h1 style="margin:14px 0 6px; font-size:44px; letter-spacing:-0.02em;">Feedback Lens</h1>
          <p style="margin:0; color:rgba(232,238,252,.75); max-width:70ch;">
            Paste noisy customer feedback and get a structured PM readout: summary, sentiment, themes, urgency.
          </p>
        </div>
        <div style="text-align:right; color:rgba(232,238,252,.6); font-size:12px;">
          <div id="status">Idle</div>
          <div style="margin-top:6px;">Deployed on Workers</div>
        </div>
      </div>

      <div style="margin-top:22px; display:grid; grid-template-columns: 1.1fr .9fr; gap:14px;">
        <div style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.10); border-radius:16px; padding:16px;">
          <div style="font-size:13px; color:rgba(232,238,252,.7); margin-bottom:10px;">Customer feedback</div>
          <textarea id="fb" rows="9" placeholder="Example: 'The dashboard takes forever to load and support keeps asking me to repeat steps...'"
            style="width:100%; resize:vertical; padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,.14);
                   background:rgba(5,8,13,.7); color:#e8eefc; outline:none; line-height:1.45;"></textarea>
          <div style="display:flex; gap:10px; align-items:center; margin-top:12px; flex-wrap:wrap;">
            <button id="btn" onclick="analyze()"
              style="padding:10px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.14);
                     background:linear-gradient(180deg, rgba(99,102,241,.9), rgba(59,130,246,.75));
                     color:white; font-weight:600; cursor:pointer;">
              Analyze
            </button>
            <button onclick="fillExample()"
              style="padding:10px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.14);
                     background:rgba(255,255,255,.06); color:#e8eefc; cursor:pointer;">
              Use example
            </button>
            <span style="font-size:12px; color:rgba(232,238,252,.6);">
              Tip: try multiple feedback snippets to show theme consistency.
            </span>
          </div>
        </div>

        <div style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.10); border-radius:16px; padding:16px;">
          <div style="font-size:13px; color:rgba(232,238,252,.7); margin-bottom:10px;">PM readout</div>

          <div style="display:grid; gap:10px;">
            <div style="background:rgba(5,8,13,.55); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:12px;">
              <div style="font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:rgba(232,238,252,.55);">Summary</div>
              <div id="summary" style="margin-top:6px; font-size:14px; color:rgba(232,238,252,.92);">—</div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <div style="background:rgba(5,8,13,.55); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:12px;">
                <div style="font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:rgba(232,238,252,.55);">Sentiment</div>
                <div id="sentiment" style="margin-top:6px; font-size:14px;">—</div>
              </div>
              <div style="background:rgba(5,8,13,.55); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:12px;">
                <div style="font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:rgba(232,238,252,.55);">Urgency</div>
                <div id="urgency" style="margin-top:6px; font-size:14px;">—</div>
              </div>
            </div>

            <div style="background:rgba(5,8,13,.55); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:12px;">
              <div style="font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:rgba(232,238,252,.55);">Themes</div>
              <div id="themes" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:8px;"></div>
            </div>

            <details style="background:rgba(5,8,13,.55); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:12px;">
              <summary style="cursor:pointer; color:rgba(232,238,252,.8);">Raw JSON (debug)</summary>
              <pre id="raw" style="margin-top:10px; white-space:pre-wrap; font-size:12px; color:rgba(232,238,252,.7);"></pre>
            </details>
          </div>
        </div>
      </div>

      <div style="margin-top:16px; color:rgba(232,238,252,.5); font-size:12px;">
        Stored entries are written to Cloudflare KV with a timestamp key. AI analysis is performed with Workers AI.
      </div>
    </div>

    <script>
      function fillExample(){
        document.getElementById("fb").value =
          "Love the product concept, but the dashboard is confusing. I can’t find billing, and pages load slowly on mobile. Support tickets take days to get a response.";
      }

      function setStatus(t){
        document.getElementById("status").textContent = t;
      }

      function chip(text){
        const el = document.createElement("span");
        el.textContent = text;
        el.style.padding = "6px 10px";
        el.style.borderRadius = "999px";
        el.style.border = "1px solid rgba(255,255,255,.12)";
        el.style.background = "rgba(255,255,255,.06)";
        el.style.fontSize = "12px";
        el.style.color = "rgba(232,238,252,.9)";
        return el;
      }

      function setReadout(parsed){
        const summary = parsed?.summary ?? "—";
        const sentiment = parsed?.sentiment ?? "—";
        const urgency = parsed?.urgency ?? "—";
        const themes = Array.isArray(parsed?.themes) ? parsed.themes : [];

        document.getElementById("summary").textContent = summary;
        document.getElementById("sentiment").textContent = sentiment;
        document.getElementById("urgency").textContent = urgency;

        const themesEl = document.getElementById("themes");
        themesEl.innerHTML = "";
        if (themes.length === 0) {
          themesEl.textContent = "—";
        } else {
          themes.forEach(t => themesEl.appendChild(chip(t)));
        }
      }

      async function analyze(){
        const btn = document.getElementById("btn");
        const text = document.getElementById("fb").value;

        btn.disabled = true;
        btn.style.opacity = "0.7";
        setStatus("Analyzing…");

        document.getElementById("raw").textContent = "";
        setReadout(null);

        try{
          const res = await fetch("/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
          });
          const data = await res.json();

          // Prefer parsed output if present; otherwise try to parse from raw.response
          const parsed = data.parsed ?? (data.raw && data.raw.response ? JSON.parse(data.raw.response) : null);

          setReadout(parsed);
          document.getElementById("raw").textContent = JSON.stringify(data, null, 2);

          setStatus(data.status === "saved" ? "Saved to KV ✓" : "Done");
        }catch(e){
          setStatus("Error");
          document.getElementById("raw").textContent = String(e);
        } finally {
          btn.disabled = false;
          btn.style.opacity = "1";
        }
      }
    </script>
  </body>
</html>
    `;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
} satisfies ExportedHandler<Env>;
