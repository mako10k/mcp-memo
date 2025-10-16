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

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
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
}

export async function generateStructuredChatCompletion<T>(
  env: EnvVars,
  options: JsonChatCompletionOptions<T>
): Promise<T> {
  const body = {
    model: env.OPENAI_RESPONSES_MODEL,
    temperature: options.temperature,
    top_p: options.topP,
    max_tokens: options.maxOutputTokens,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt }
    ],
    response_format: { type: "json_object" }
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
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Chat completion returned no content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Chat completion did not return valid JSON: ${(error as Error).message}`);
  }

  return options.schema.parse(parsed);
}
