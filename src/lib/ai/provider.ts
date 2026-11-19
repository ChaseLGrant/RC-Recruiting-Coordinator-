// AI model provider abstraction. In RC, AI is an *assistant to the parser*
// only: it may turn free text into structured criteria, which the coach then
// sees and edits. It is never used to grade athletes, invent data, or decide.

import type { RecruitingCriteria } from "../domain/types";

export interface AiProvider {
  name: string;
  /** Returns a partial criteria object extracted from text, or null. */
  extractCriteria(text: string): Promise<Partial<RecruitingCriteria> | null>;
}

class AnthropicProvider implements AiProvider {
  name = "Anthropic";
  constructor(private key: string, private model: string) {}
  async extractCriteria(text: string) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 800,
        system:
          "Extract recruiting search filters from a college coach's request. Reply with JSON only, matching: " +
          '{"gradYears":number[],"positions":string[] (SS,2B,3B,1B,C,CF,OF,RHP,LHP),"metrics":[{"key":"height_in|weight_lb|exit_velo_mph|sixty_yd_sec|inf_velo_mph|of_velo_mph|fb_velo_mph|pop_time_sec|gpa","op":"gte|lte","value":number,"importance":"required|preferred|optional"}],"uncommittedOnly":boolean}. ' +
          "Only include filters the coach explicitly stated. Never add standards they did not state.",
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    const out = j.content.find((c) => c.type === "text")?.text ?? "";
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Partial<RecruitingCriteria>;
    } catch {
      return null;
    }
  }
}

export function getAiProvider(env = process.env): AiProvider | null {
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.RC_AI_MODEL ?? "claude-sonnet-5-5");
  return null;
}
