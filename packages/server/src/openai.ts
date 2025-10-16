import { z } from "zod";

import { EnvVars } from "./env";

export interface EmbeddingResult {
  vector: number[];
  model: string;
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
}

export async function generateEmbedding(env: EnvVars, input: string): Promise<EmbeddingResult> {
  const body = {
    input,
    model: env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"
  };

  const endpoint = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/embeddings";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to generate embedding: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const json = (await response.json()) as OpenAIEmbeddingResponse;
  if (!json.data?.length) {
    throw new Error("Embedding API returned no data");
  }

  return {
    vector: json.data[0].embedding,
    model: json.model
  };
}

type ChatCompletionContentPart =
  | { type: "text"; text: string }
  | { type: "output_text"; text: string }
  | { type: string; [key: string]: unknown };

interface ChatCompletionToolCall {
  id?: string;
  type: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | ChatCompletionContentPart[];
      tool_calls?: ChatCompletionToolCall[];
    };
  }>;
}

interface JsonChatCompletionOptions<T> {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  schema: z.ZodType<T>;
  jsonSchema?: Record<string, unknown>;
  toolName?: string;
  toolDescription?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export async function generateStructuredChatCompletion<T>(
  env: EnvVars,
  options: JsonChatCompletionOptions<T>
): Promise<T> {
  const shouldForceTool = Boolean(options.jsonSchema);
  const toolName = options.toolName ?? "submit_structured_output";
  const toolDescription =
    options.toolDescription ?? "Return the final structured result as a JSON object.";

  const body = {
    model: env.OPENAI_RESPONSES_MODEL,
    temperature: options.temperature,
    top_p: options.topP,
    max_completion_tokens: options.maxOutputTokens,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt }
    ] as const,
    ...(shouldForceTool && options.jsonSchema
      ? {
          tools: [
            {
              type: "function" as const,
              function: {
                name: toolName,
                description: toolDescription,
                parameters: options.jsonSchema
              }
            }
          ],
          tool_choice: {
            type: "function" as const,
            function: { name: toolName }
          },
          parallel_tool_calls: false
        }
      : {}),
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {})
  };

  const endpoint = env.OPENAI_RESPONSES_BASE_URL ?? "https://api.openai.com/v1/chat/completions";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to generate chat completion: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  const json = (await response.json()) as ChatCompletionResponse;
  let parsed: unknown;

  if (shouldForceTool && options.jsonSchema) {
    const toolCalls = json.choices?.[0]?.message?.tool_calls ?? [];
    const selectedCall =
      toolCalls.find((call) => call.type === "function" && call.function?.name === toolName) ??
      toolCalls[0];

    const rawArguments = selectedCall?.function?.arguments;
    if (!rawArguments) {
      const serialized = JSON.stringify(json).slice(0, 2000);
      throw new Error(`Chat completion returned no tool call arguments: ${serialized}`);
    }

    try {
      parsed = JSON.parse(rawArguments);
    } catch (error) {
      throw new Error(
        `Chat completion tool call arguments were not valid JSON: ${(error as Error).message}`
      );
    }
  } else {
    const messageContent = json.choices?.[0]?.message?.content;
    let content: string | undefined;
    if (typeof messageContent === "string") {
      content = messageContent;
    } else if (Array.isArray(messageContent)) {
      const textChunk = messageContent.find((item) => {
        if (item && typeof item === "object") {
          if ("text" in item && typeof (item as { text?: unknown }).text === "string") {
            return true;
          }
        }
        return false;
      }) as { text?: string } | undefined;
      content = textChunk?.text;
    }

    if (!content) {
      const serialized = JSON.stringify(json).slice(0, 2000);
      throw new Error(`Chat completion returned no content: ${serialized}`);
    }

    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Chat completion did not return valid JSON: ${(error as Error).message}`);
    }
  }

  try {
    return options.schema.parse(parsed);
  } catch (error) {
    const detail = JSON.stringify(parsed).slice(0, 2000);
    throw new Error(`Structured output failed validation: ${(error as Error).message} | payload=${detail}`);
  }
}
