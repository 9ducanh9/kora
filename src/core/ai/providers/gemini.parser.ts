import { GoogleGenerativeAI } from '@google/generative-ai';
import { ArchitectureContext, ArchitectureParser, ArchitectureParseError, ParserRequestOptions } from '../parser.interface';
import { KORA_SYSTEM_PROMPT } from '../systemPrompt';
import { validateArchitectureModel } from '../../ir/validator';

export class GeminiArchitectureParser implements ArchitectureParser {
  readonly id = 'gemini';
  readonly name = 'Google Gemini (2.5 Flash)';

  private apiKey: string;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.modelName = modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  getModelName(): string {
    return this.modelName;
  }

  async parse(prompt: string, context?: ArchitectureContext, options: ParserRequestOptions = {}) {
    if (!this.apiKey) {
      throw new ArchitectureParseError('MISSING_PROVIDER_KEY', 'Thiếu Gemini API Key.', [], 401);
    }

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: KORA_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    const userMessage = context?.scope 
      ? `[Requested Scope: ${context.scope}]\n\nArchitecture Description:\n${prompt}`
      : `Architecture Description:\n${prompt}`;

    const result = await model.generateContent(userMessage, { signal: options.signal });
    const responseText = result.response.text();

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(responseText);
    } catch {
      throw new ArchitectureParseError('PROVIDER_INVALID_JSON', 'Gemini trả về JSON không hợp lệ.');
    }

    const validation = validateArchitectureModel(rawJson);
    if (!validation.ok) throw new ArchitectureParseError('PROVIDER_INVALID_MODEL', 'Gemini trả về kiến trúc không hợp lệ.', validation.issues);

    return { model: validation.value, issues: validation.issues };
  }
}
