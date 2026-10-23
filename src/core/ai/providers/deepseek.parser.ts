import { ArchitectureContext, ArchitectureParser, ArchitectureParseError, ParserRequestOptions } from '../parser.interface';
import { KORA_SYSTEM_PROMPT } from '../systemPrompt';
import { validateProviderArchitectureModel } from '../providerModel';

export class DeepSeekArchitectureParser implements ArchitectureParser {
  readonly id = 'deepseek';
  readonly name = 'DeepSeek (V3)';

  private apiKey: string;
  private modelName: string;
  private fetcher: typeof fetch;

  constructor(apiKey?: string, modelName?: string, fetcher: typeof fetch = globalThis.fetch) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || '';
    this.modelName = modelName || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.fetcher = fetcher;
  }

  getModelName(): string {
    return this.modelName;
  }

  async parse(prompt: string, context?: ArchitectureContext, options: ParserRequestOptions = {}) {
    const userMessage = context?.scope
      ? `[Requested Scope: ${context.scope}]\n\nArchitecture Description:\n${prompt}`
      : `Architecture Description:\n${prompt}`;
    const response = await this.generateJson(KORA_SYSTEM_PROMPT, userMessage, options);
    const validation = validateProviderArchitectureModel(response.value);
    if (!validation.ok) throw new ArchitectureParseError('PROVIDER_INVALID_MODEL', 'AI chưa tạo được dữ liệu sơ đồ đúng định dạng. Nội dung mô tả của bạn vẫn được giữ nguyên.', validation.issues);
    return { model: validation.value, issues: validation.issues, observation: response.observation };
  }

  /** Shared transport for extraction and graph generation; callers own the operation budget. */
  async generateJson(systemPrompt: string, userMessage: string, options: ParserRequestOptions = {}) {
    if (!this.apiKey) {
      throw new ArchitectureParseError('MISSING_PROVIDER_KEY', 'Thiếu DeepSeek API Key.', [], 401);
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort('provider-timeout'); }, options.timeoutMs ?? 90_000);
    try {
      if (options.signal?.aborted) throw new DOMException('Provider request was cancelled.', 'AbortError');
      options.onRequestSent?.();
      const res = await this.fetcher('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        options.onObservation?.({ requestedModel: this.modelName, httpStatus: res.status, durationMs: Date.now() - startedAt });
        throw new ArchitectureParseError('PROVIDER_REQUEST_FAILED', `DeepSeek trả về HTTP ${res.status}.`);
      }

      let data: any;
      try {
        data = await res.json();
      } catch {
        options.onObservation?.({ requestedModel: this.modelName, httpStatus: res.status, durationMs: Date.now() - startedAt });
        throw new ArchitectureParseError('PROVIDER_INVALID_JSON', 'DeepSeek trả về JSON không hợp lệ.');
      }
      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage && typeof data.usage === 'object' ? {
        promptTokens: Number.isFinite(data.usage.prompt_tokens) ? data.usage.prompt_tokens : undefined,
        completionTokens: Number.isFinite(data.usage.completion_tokens) ? data.usage.completion_tokens : undefined,
        totalTokens: Number.isFinite(data.usage.total_tokens) ? data.usage.total_tokens : undefined
      } : undefined;
      const observation = {
        requestedModel: this.modelName,
        returnedModel: typeof data.model === 'string' ? data.model : undefined,
        returnedFingerprint: typeof data.system_fingerprint === 'string' ? data.system_fingerprint : undefined,
        httpStatus: res.status,
        durationMs: Date.now() - startedAt,
        usage,
        finishReason: typeof data.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason : undefined
      };
      options.onObservation?.(observation);
      if (observation.finishReason === 'length') {
        throw new ArchitectureParseError('PROVIDER_TRUNCATED_RESPONSE', 'AI dừng trước khi hoàn tất dữ liệu sơ đồ. Nội dung mô tả của bạn vẫn được giữ nguyên.');
      }
      if (!content) throw new ArchitectureParseError('PROVIDER_EMPTY_RESPONSE', 'DeepSeek không trả về nội dung kiến trúc.');

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(content);
      } catch {
        throw new ArchitectureParseError('PROVIDER_INVALID_JSON', 'DeepSeek trả về JSON không hợp lệ.');
      }

      return { value: rawJson, observation };
    } catch (error) {
      if (timedOut) throw new ArchitectureParseError('PROVIDER_TIMEOUT', `DeepSeek request exceeded its ${options.timeoutMs ?? 90_000} millisecond deadline.`, [], 504);
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      if (error instanceof ArchitectureParseError) throw error;
      throw new ArchitectureParseError('PROVIDER_REQUEST_FAILED', 'Không thể kết nối DeepSeek.');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
