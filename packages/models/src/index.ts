import {
  resolveApiKeyForProvider,
  getProviderBaseUrl,
} from "./credentials.js";
import {
  getProvider,
  getModelEntry,
  listModelIds,
  resolveMaxTokensField,
  adaptMessagesForModel,
  type ModelRef,
  type ChatMessage,
  type ChatResponse,
} from "./providers.js";

export * from "./providers.js";
export * from "./credentials.js";
export * from "./failover.js";

import {
  runWithModelFallback,
  defaultFallbackChain,
  type FailoverAttempt,
} from "./failover.js";

const DEFAULT_MAX_TOKENS = 4096;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NativeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Opaque metadata required by specific providers on the next tool turn. */
  providerData?: { google?: { thoughtSignature?: string } };
}

export interface ChatCompletionResult extends ChatResponse {
  toolCalls?: NativeToolCall[];
}

export interface ChatCompletionOptions {
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  /** Extra models to try after primary fails (500/503/429/auth…). */
  fallbacks?: ModelRef[];
  /** When true (default), append provider-sensible defaults if fallbacks empty. */
  useDefaultFallbacks?: boolean;
  onFallback?: (from: ModelRef, to: ModelRef, reason: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidModelResponse(provider: string, detail: string): Error {
  return new Error(`Invalid ${provider} model response: ${detail}`);
}

/** Runtime validation for data received from OpenAI-compatible endpoints. */
export function parseOpenAIChatResponse(
  raw: unknown,
  fallbackModel: string,
  providerId: string,
): ChatCompletionResult {
  if (!isRecord(raw)) throw invalidModelResponse(providerId, "expected an object");
  if (!Array.isArray(raw.choices) || !raw.choices.length) {
    throw invalidModelResponse(providerId, "missing non-empty choices array");
  }
  const first = raw.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw invalidModelResponse(providerId, "missing choices[0].message object");
  }
  const message = first.message;
  const content =
    typeof message.content === "string" || message.content === null
      ? (message.content ?? "")
      : "";
  const toolCalls: NativeToolCall[] = [];
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) {
      throw invalidModelResponse(providerId, "message.tool_calls must be an array");
    }
    for (const [index, candidate] of message.tool_calls.entries()) {
      if (!isRecord(candidate) || !isRecord(candidate.function)) continue;
      const fn = candidate.function;
      if (typeof fn.name !== "string" || !fn.name.trim()) continue;
      let args: Record<string, unknown> = {};
      if (typeof fn.arguments === "string" && fn.arguments.trim()) {
        try {
          const parsed: unknown = JSON.parse(fn.arguments);
          if (isRecord(parsed)) args = parsed;
        } catch {
          // Invalid tool arguments are an empty object, never a crash/null spread.
        }
      }
      const extra = isRecord(candidate.extra_content) ? candidate.extra_content : undefined;
      const google = extra && isRecord(extra.google) ? extra.google : undefined;
      const thoughtSignature =
        google && typeof google.thought_signature === "string"
          ? google.thought_signature
          : undefined;
      toolCalls.push({
        id:
          typeof candidate.id === "string" && candidate.id
            ? candidate.id
            : `tool_${index}`,
        name: fn.name,
        arguments: args,
        ...(thoughtSignature ? { providerData: { google: { thoughtSignature } } } : {}),
      });
    }
  }
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  const promptTokens = usage?.prompt_tokens;
  const completionTokens = usage?.completion_tokens;
  return {
    content,
    model: typeof raw.model === "string" && raw.model ? raw.model : fallbackModel,
    provider: providerId,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage:
      typeof promptTokens === "number" && typeof completionTokens === "number"
        ? { promptTokens, completionTokens }
        : undefined,
  };
}

/** Runtime validation for data received from Anthropic-compatible endpoints. */
export function parseAnthropicChatResponse(
  raw: unknown,
  fallbackModel: string,
  providerId: string,
): ChatCompletionResult {
  if (!isRecord(raw)) throw invalidModelResponse(providerId, "expected an object");
  if (!Array.isArray(raw.content)) {
    throw invalidModelResponse(providerId, "missing content array");
  }
  const blocks = raw.content.filter(isRecord);
  const text = blocks.find((block) => block.type === "text");
  const toolCalls: NativeToolCall[] = [];
  for (const [index, block] of blocks.entries()) {
    if (block.type !== "tool_use" || typeof block.name !== "string" || !block.name.trim()) {
      continue;
    }
    toolCalls.push({
      id: typeof block.id === "string" && block.id ? block.id : `tool_${index}`,
      name: block.name,
      arguments: isRecord(block.input) ? block.input : {},
    });
  }
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  return {
    content: text && typeof text.text === "string" ? text.text : "",
    model: typeof raw.model === "string" && raw.model ? raw.model : fallbackModel,
    provider: providerId,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage:
      typeof inputTokens === "number" && typeof outputTokens === "number"
        ? { promptTokens: inputTokens, completionTokens: outputTokens }
        : undefined,
  };
}

/**
 * OpenClaw-style openai-completions call with optional native tools + failover.
 */
export async function chatCompletion(
  ref: ModelRef,
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const fallbacks =
    options?.fallbacks?.length
      ? options.fallbacks
      : options?.useDefaultFallbacks === false
        ? []
        : defaultFallbackChain(ref);

  return runWithModelFallback(
    ref,
    fallbacks,
    (candidate) => chatCompletionOnce(candidate, adaptMessagesForModel(candidate, messages), options),
    { sameModelRetries: 1, onFallback: options?.onFallback },
  );
}

/** Single-model call (no failover). Prefer chatCompletion. */
export async function chatCompletionOnce(
  ref: ModelRef,
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const provider = getProvider(ref.provider);
  if (!provider) {
    throw new Error(`Unknown provider: ${ref.provider}`);
  }

  const apiKey = await resolveApiKeyForProvider(ref.provider);
  if (provider.authType === "api_key" && !apiKey) {
    throw new Error(
      `No API key for ${provider.name}. Run: hey models auth ${ref.provider}`,
    );
  }

  const baseUrl = (await getProviderBaseUrl(ref.provider)) ?? provider.baseUrl;
  if (!baseUrl) {
    throw new Error(`No base URL configured for ${provider.name}`);
  }

  // Bedrock Mantle: Anthropic Claude* models use Messages API, not /v1/chat/completions.
  if (ref.provider === "bedrock" && /^anthropic\./i.test(ref.model)) {
    const regionHost = baseUrl.replace(/\/v1\/?$/, "").replace(/\/anthropic(\/v1)?\/?$/, "");
    const messagesBase = `${regionHost}/anthropic/v1`;
    return chatAnthropic(messagesBase, apiKey!, ref.model, messages, options, {
      authHeader: "bearer",
      providerId: "bedrock",
    });
  }

  if (provider.api === "anthropic-messages" || ref.provider === "anthropic") {
    return chatAnthropic(baseUrl, apiKey!, ref.model, messages, options, {
      authHeader: "x-api-key",
      providerId: "anthropic",
    });
  }

  return chatOpenAICompletions(
    baseUrl,
    apiKey,
    ref.model,
    messages,
    ref.provider,
    options,
  );
}

export type { FailoverAttempt };

async function chatOpenAICompletions(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  messages: ChatMessage[],
  providerId: string,
  options?: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const provider = getProvider(providerId);
  const modelEntry = getModelEntry(providerId, model);
  const maxTokensField = resolveMaxTokensField(
    providerId,
    model,
    provider?.compat,
    modelEntry?.compat,
  );

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const apiMessages = messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => {
          const signature = tc.providerData?.google?.thoughtSignature;
          return {
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
            // Gemini's OpenAI-compatible endpoint returns this opaque field.
            // It must be replayed on the matching function-call part.
            ...(signature
              ? { extra_content: { google: { thought_signature: signature } } }
              : {}),
          };
        }),
      };
    }
    if (m.images?.length) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content || " " },
          ...m.images.map((img) => ({
            type: "image_url",
            image_url: {
              url: `data:${img.mimeType};base64,${img.data}`,
              detail: img.detail ?? "high",
            },
          })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const body: Record<string, unknown> = { model, messages: apiMessages };
  if (maxTokensField === "max_tokens") {
    body.max_tokens = maxTokens;
  } else {
    body.max_completion_tokens = maxTokens;
  }

  if (options?.tools?.length) {
    body.tools = options.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = options.toolChoice ?? "auto";
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Model API error (${res.status}): ${text.slice(0, 500)}`);
  }

  return parseOpenAIChatResponse(await res.json(), model, providerId);
}

async function chatAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
  transport?: { authHeader?: "x-api-key" | "bearer"; providerId?: string },
): Promise<ChatCompletionResult> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const chatMessages = messages
    .filter((m) => m.role !== "system" && m.role !== "tool")
    .map((m) => {
      if (m.images?.length) {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content || " " },
            ...m.images.map((img) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.data,
              },
            })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: chatMessages,
  };

  if (options?.tools?.length) {
    body.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const authHeader = transport?.authHeader ?? "x-api-key";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (authHeader === "bearer") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers["x-api-key"] = apiKey;
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${text.slice(0, 500)}`);
  }

  const providerId = transport?.providerId ?? "anthropic";
  return parseAnthropicChatResponse(await res.json(), model, providerId);
}

export async function smokeTest(ref: ModelRef): Promise<{ ok: boolean; message: string }> {
  try {
    // No failover — show the real primary model error (Bedrock 404s were masked).
    const res = await chatCompletionOnce(ref, [
      { role: "user", content: "Reply with exactly: HEYAGENT_OK" },
    ]);
    const ok = res.content.includes("HEYAGENT_OK") || res.content.length > 0;
    return {
      ok,
      message: ok
        ? `Model responded successfully (${ref.provider}/${ref.model}).`
        : "Empty response.",
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function listRemoteModels(providerId: string): Promise<string[]> {
  const provider = getProvider(providerId);
  if (!provider) return [];

  if (providerId === "ollama") {
    try {
      const baseUrl = (await getProviderBaseUrl(providerId)) ?? provider.baseUrl!;
      const res = await fetch(`${baseUrl.replace(/\/v1$/, "")}/api/tags`);
      if (!res.ok) return listModelIds(provider);
      const data = (await res.json()) as { models: { name: string }[] };
      return data.models.map((m) => m.name);
    } catch {
      return listModelIds(provider);
    }
  }

  if (providerId === "bedrock") {
    try {
      const baseUrl = (await getProviderBaseUrl(providerId)) ?? provider.baseUrl!;
      const apiKey = await resolveApiKeyForProvider(providerId);
      if (!apiKey) return listModelIds(provider);
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return listModelIds(provider);
      const data = (await res.json()) as { data?: { id: string }[] };
      const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
      if (ids.length) return ids;
    } catch {
      /* fall through to catalog */
    }
    return listModelIds(provider);
  }

  return listModelIds(provider);
}
