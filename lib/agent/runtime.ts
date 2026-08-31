import "server-only";

import { generateObject, generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { parseIntent } from "./intent";
import {
  AGENT_SYSTEM_PROMPT,
  AgentPlanSchema,
  CompareScenariosArgsSchema,
  FocusHotspotArgsSchema,
  QueryHospitalCapacityArgsSchema,
  RunCounterfactualArgsSchema,
  TOOL_DEFINITIONS,
  ToolCallSchema,
  type AgentContext,
  type AgentPlan,
  type ToolCall,
} from "./tools";

export type AgentRuntimeKind = "anthropic" | "openai" | "neon-gateway" | "intent-parser";

type LanguageModel = Parameters<typeof generateObject>[0]["model"];

const sdkTools = {
  run_counterfactual: tool({
    description: TOOL_DEFINITIONS[0].description,
    parameters: RunCounterfactualArgsSchema,
  }),
  focus_hotspot: tool({
    description: TOOL_DEFINITIONS[1].description,
    parameters: FocusHotspotArgsSchema,
  }),
  query_hospital_capacity: tool({
    description: TOOL_DEFINITIONS[2].description,
    parameters: QueryHospitalCapacityArgsSchema,
  }),
  compare_scenarios: tool({
    description: TOOL_DEFINITIONS[3].description,
    parameters: CompareScenariosArgsSchema,
  }),
};

function resolveModel(): { kind: AgentRuntimeKind; model: LanguageModel | null } {
  const neonKey = process.env.NEON_AI_GATEWAY_TOKEN;
  const neonBase = process.env.NEON_AI_GATEWAY_BASE_URL;
  if (neonKey && neonBase) {
    const openai = createOpenAI({
      apiKey: neonKey,
      baseURL: `${neonBase.replace(/\/$/, "")}/v1`,
    });
    return { kind: "neon-gateway", model: openai(process.env.AGENT_MODEL ?? "gpt-4o-mini") };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return {
      kind: "anthropic",
      model: anthropic(process.env.AGENT_MODEL ?? "claude-3-5-haiku-20241022"),
    };
  }
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return { kind: "openai", model: openai(process.env.AGENT_MODEL ?? "gpt-4o-mini") };
  }
  return { kind: "intent-parser", model: null };
}

function toolCallsFromSdk(calls: Array<{ toolName: string; args: unknown }>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const call of calls) {
    const parsed = ToolCallSchema.safeParse({ name: call.toolName, args: call.args });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function planQuery(query: string, context: AgentContext): Promise<AgentPlan & { runtime: AgentRuntimeKind }> {
  const fallback = parseIntent(query, context);
  const resolved = resolveModel();
  if (!resolved.model) {
    return { ...fallback, runtime: "intent-parser" };
  }
  const prompt = `User query:\n${query}\n\nLive twin context (JSON):\n${JSON.stringify(context)}\n\nTool JSON Schema:\n${JSON.stringify(TOOL_DEFINITIONS)}`;
  try {
    const generated = await generateText({
      model: resolved.model,
      tools: sdkTools,
      toolChoice: "required",
      maxSteps: 1,
      system: AGENT_SYSTEM_PROMPT,
      prompt,
    });
    const tools = toolCallsFromSdk(
      (generated.toolCalls ?? []).map((c) => ({ toolName: c.toolName, args: c.args })),
    );
    if (tools.length > 0) {
      const narrative =
        generated.text && /\[[^\]]+\]/.test(generated.text) ? generated.text : fallback.narrative;
      return {
        ...AgentPlanSchema.parse({
          tools: tools.slice(0, 4),
          narrative,
          citations: fallback.citations,
          camera: fallback.camera,
        }),
        runtime: resolved.kind,
      };
    }
  } catch {
    /* fall through to generateObject */
  }
  try {
    const { object } = await generateObject({
      model: resolved.model,
      schema: AgentPlanSchema,
      schemaName: "AgentPlan",
      system: AGENT_SYSTEM_PROMPT,
      prompt,
    });
    return { ...AgentPlanSchema.parse(object), runtime: resolved.kind };
  } catch {
    return { ...fallback, runtime: "intent-parser" };
  }
}
